// ==UserScript==
// @name         LEA Auto Order Assistant
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.2.0
// @match        https://game.logistics-empire.com/*
// @description  Automatischer Assistent. 1-Klick Abarbeitung von Aufträgen im Handelszentrum.
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js?v=1.0.13
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-order.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-order.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & SELEKTOREN
    // =========================================================================

    const ASSISTANT_BTN_SELECTOR = LEA_CONFIG.ASSISTANT_BTN_SELECTOR;
    const ALL_REWARDS_BTN_SELECTOR = LEA_CONFIG.ALL_REWARDS_BTN_SELECTOR;
    const HANDELSZENTRUM_HEADER_SRC = LEA_CONFIG.HANDELSZENTRUM_HEADER_SRC;
    const INJECT_BTN_ID = 'lef-auto-start-btn';

    // Bild-Dateinamen für Buttons
    const IMG_AUTO_SELECT = LEA_CONFIG.IMG_AUTO_SELECT; // 'auto_select'

    let isAutoRunning = false;
    let stopRequested = false;

    // Zustand für Sicherheits-Lock bei manueller Lieferzeitüberschreitung
    let lastVehicleWindowKey = null;
    let lockUntilTime = 0;
    let preemptiveLockUntilTime = 0;
    let autoSelectClickTime = 0;
    let waitingForDeliveryTime = false;
    let hasLockedThisWindow = false;

    // =========================================================================
    // UI: WARN-POPUP (Passiv für manuelles Spielen)
    // =========================================================================

    let warningDiv = null;

    function showTimeWarning(show, msg = '') {
        if (!warningDiv) {
            warningDiv = document.createElement('div');
            warningDiv.className = 'lea-warning-banner';
            warningDiv.style.display = 'none';
            document.body.appendChild(warningDiv);
        }

        if (show) {
            warningDiv.innerHTML = '⚠️ ACHTUNG: ' + msg;
            warningDiv.style.display = 'block';
        } else {
            warningDiv.style.display = 'none';
        }
    }

    function getVehicleWindowKey() {
        const header = document.querySelector('.bb-dialog .text-h2, .bottom-navigation .text-h2, h2, .text-h2');
        const address = document.querySelector('.bb-dialog .text-p2-400, .bottom-navigation .text-p2-400, .text-p2-400');
        
        const headerText = header ? header.textContent.trim() : '';
        const addressText = address ? address.textContent.trim() : '';
        
        return `${headerText}|${addressText}`;
    }

    function enableTransportButtons(enabled) {
        const assistantBtn = document.querySelector(ASSISTANT_BTN_SELECTOR);
        const nextStepBtn = document.querySelector(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR);

        [assistantBtn, nextStepBtn].forEach(btn => {
            if (btn) {
                if (!enabled) {
                    btn.disabled = true;
                    btn.classList.add('lea-btn-disabled');
                } else {
                    btn.disabled = false;
                    btn.classList.remove('lea-btn-disabled');
                }
            }
        });
    }

    function passiveCheckDeliveryTime() {
        // Deaktiviere die Warnung und entsperre Knöpfe, wenn ein automatisches Skript arbeitet
        if (isAutoRunning || (window.LEA_CONFIG && window.LEA_CONFIG.isAutomationRunning)) {
            showTimeWarning(false);
            enableTransportButtons(true);
            return;
        }

        const pageText = document.body.textContent || '';
        const isVehicleWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität/);

        if (!isVehicleWindow) {
            showTimeWarning(false);
            lastVehicleWindowKey = null;
            hasLockedThisWindow = false;
            lockUntilTime = 0;
            preemptiveLockUntilTime = 0;
            waitingForDeliveryTime = false;
            enableTransportButtons(true);
            return;
        }

        // Window-Wechsel oder Erstöffnung erkennen
        const currentWindowKey = getVehicleWindowKey();
        if (currentWindowKey !== lastVehicleWindowKey) {
            lastVehicleWindowKey = currentWindowKey;
            hasLockedThisWindow = false;
            lockUntilTime = 0;
            preemptiveLockUntilTime = 0;
            waitingForDeliveryTime = false;
            enableTransportButtons(true);
        }

        // 1. Präemptive Sperre & Warten auf Lieferzeit prüfen (Server-Lag Schutz)
        const remainingPreemptiveMs = preemptiveLockUntilTime - Date.now();
        const result = getDeliveryTimeSeconds();

        // Sicherheits-Fallback falls die Lieferzeit gar nicht lädt (max. 4 Sekunden)
        if (waitingForDeliveryTime && Date.now() - autoSelectClickTime > 4000) {
            console.warn('[LEF Safety Lock] Lieferzeit-Ladezeit überschritten (Fallback greift).');
            waitingForDeliveryTime = false;
            preemptiveLockUntilTime = 0;
        }

        // Wenn die 1 Sekunde Mindestsperre läuft ODER wir auf die Lieferzeit warten und diese noch fehlt
        if (remainingPreemptiveMs > 0 || (waitingForDeliveryTime && !result)) {
            enableTransportButtons(false);
            if (!result) {
                showTimeWarning(true, `Lieferzeit wird geladen...`);
            } else {
                const remainingSecs = (remainingPreemptiveMs / 1000).toFixed(1);
                showTimeWarning(true, `Fahrzeuge werden gewählt... (${remainingSecs}s)`);
            }
            return;
        }

        // Sobald die Lieferzeit geladen ist, heben wir den Lade-Zustand auf
        if (waitingForDeliveryTime && result) {
            waitingForDeliveryTime = false;
            preemptiveLockUntilTime = 0;
        }

        // 2. Reguläre Lieferzeit-Sperre prüfen
        if (result && result.seconds > LEA_CONFIG.settings.maxOrderDeliveryTimeMinutes * 60) {
            if (!hasLockedThisWindow) {
                hasLockedThisWindow = true;
                lockUntilTime = Date.now() + 2000; // 2 Sekunden Sperre
                console.log(`[LEA Safety Lock] Lieferzeit zu hoch (${result.timeString}). Sperre Knöpfe für 2 Sekunden.`);
            }

            const remainingMs = lockUntilTime - Date.now();
            if (remainingMs > 0) {
                enableTransportButtons(false);
                const remainingSecs = (remainingMs / 1000).toFixed(1);
                showTimeWarning(true, `Lieferzeit zu hoch! (${result.timeString}) - Knöpfe gesperrt (${remainingSecs}s)`);
            } else {
                enableTransportButtons(true);
                showTimeWarning(true, `Lieferzeit zu hoch! (${result.timeString})`);
            }
        } else {
            enableTransportButtons(true);
            showTimeWarning(false);
        }
    }

    // =========================================================================
    // 1-KLICK AUFTRAGS-LOGIK & HELPER
    // =========================================================================

    /**
     * Prüft, ob ein Auftrag anhand des Kundennamens übersprungen werden soll.
     * @param {HTMLElement} element - Die Auftragskachel oder ein Kind-Element.
     * @returns {boolean} True, wenn der Auftrag übersprungen werden soll.
     */
    function shouldSkipOrder(element) {
        const excludeSetting = LEA_CONFIG.settings.excludeOrderNames;
        if (!excludeSetting) return false;

        const card = element.closest('.bb-vl-item-slot-root, .panel, .bb-vl-item-wrapper') || element;
        const titleEl = card.querySelector('.order-header .text-h2, .text-h2, [class*="text-h2"]');
        const streetEl = card.querySelector('.order-header .text-p2-400, .text-p2-400, [class*="text-p2"]');

        const title = titleEl ? titleEl.textContent.trim() : '';
        const street = streetEl ? streetEl.textContent.trim() : '';

        if (!title) return false;

        const titleLower = title.toLowerCase();
        const terms = excludeSetting.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

        for (const term of terms) {
            if (titleLower.includes(term)) {
                const logName = street ? `${title} (${street})` : title;
                console.log(`[LEF Auto Order] Überspringe Auftrag wegen Ausschlusskriterium "${term}": ${logName}`);
                return true;
            }
        }
        return false;
    }

    /**
     * Ermittelt einen eindeutigen Schlüssel für eine Auftragskachel,
     * um Duplikate bei Virtual-Scrolling zuverlässig zu verhindern.
     * @param {HTMLElement} card - Die Auftragskachel.
     * @returns {string} Eindeutiger Auftragsschlüssel.
     */
    function getOrderKey(card) {
        const wrapper = card.closest('[data-vl-reveal-key]');
        if (wrapper && wrapper.getAttribute('data-vl-reveal-key')) {
            return wrapper.getAttribute('data-vl-reveal-key');
        }
        const title = card.querySelector('.order-header .text-h2, .text-h2')?.textContent.trim() || '';
        const street = card.querySelector('.order-header .text-p2-400, .text-p2-400')?.textContent.trim() || '';
        return `${title}|${street}`;
    }

    /**
     * Sucht den 1-Klick-Button (Frau mit Helm / auto_select) auf der Auftragskachel.
     * @param {HTMLElement} card - Die Auftragskachel.
     * @returns {HTMLButtonElement|null} Der 1-Klick-Button oder null.
     */
    function get1ClickButton(card) {
        const autoImg = card.querySelector('button img[data-key="regular/auto_select"], button img[src*="auto_select"]');
        return autoImg ? autoImg.closest('button') : null;
    }

    /**
     * Prüft, ob der 1-Klick-Button klickbar ist (d. h. nicht disabled und kein grayscale).
     * @param {HTMLButtonElement} btn - Der Button.
     * @returns {boolean} True, wenn klickbar.
     */
    function is1ClickButtonEnabled(btn) {
        if (!btn) return false;
        if (btn.disabled || btn.hasAttribute('disabled')) return false;
        const img = btn.querySelector('img');
        if (img && img.classList.contains('grayscale')) return false;
        return true;
    }

    /**
     * Sucht den scrollbaren Container der Auftragsliste (Virtual List).
     * @returns {HTMLElement|null}
     */
    function getScrollContainer() {
        const row = document.querySelector('.bb-vl-virtual-row, .bb-vl-item-wrapper');
        if (!row) return null;
        let el = row.parentElement;
        while (el && el !== document.body) {
            const style = window.getComputedStyle(el);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                return el;
            }
            el = el.parentElement;
        }
        return document.querySelector('.overflow-y-auto, .overflow-y-scroll');
    }

    function isHandelszentrumOpen() {
        return !!document.querySelector(HANDELSZENTRUM_HEADER_SRC);
    }

    /**
     * Prüft, ob der Filter "Anfragen" aktiv ist.
     * @returns {boolean}
     */
    function isAnfragenActive() {
        // 1. Anfragen-Button in der Filterbar prüfen (hat data-key="regular/trade_center_open_requests" und active="true")
        const reqBtn = document.querySelector('.bb-filter-and-sort-bar img[data-key*="trade_center_open_requests"], .bb-filter-and-sort-bar img[src*="trade_center_open_requests"]')?.closest('button');
        if (reqBtn && reqBtn.getAttribute('active') === 'true') {
            return true;
        }

        // 2. Text unter der Filterleiste prüfen
        const filterLabel = document.querySelector('.bb-filter-and-sort-bar .text-sm');
        if (filterLabel && filterLabel.textContent.trim().toLowerCase() === 'anfragen') {
            return true;
        }

        // 3. Fallback: Befinden sich Aufträge im DOM?
        if (document.querySelector('[data-tutorial-id*="tradecenter.requests"], button img[src*="start_transport"]')) {
            return true;
        }

        return false;
    }

    /**
     * Stellt sicher, dass der "Anfragen" Reiter geöffnet ist.
     * @returns {Promise<boolean>}
     */
    async function ensureAnfragenTab() {
        if (isAnfragenActive()) return true;

        const reqBtn = document.querySelector('.bb-filter-and-sort-bar img[data-key*="trade_center_open_requests"], .bb-filter-and-sort-bar img[src*="trade_center_open_requests"]')?.closest('button');
        if (reqBtn) {
            console.log('[LEF Auto Order] Wechsle zum Tab "Anfragen"...');
            simulateClick(reqBtn);
            await new Promise(r => setTimeout(r, 600));
            return isAnfragenActive();
        }

        return false;
    }

    /**
     * Holt fertige Belohnungen ab ("Alle sammeln"), falls vorhanden.
     * WICHTIG: Niemals Elemente innerhalb von #headerBar anklicken!
     */
    async function collectAllRewards() {
        // Suche nach dem Text "Alle sammeln" strikt außerhalb von #headerBar
        const allTextElements = Array.from(document.querySelectorAll('div, span, p'))
            .filter(el => !el.closest('#headerBar'));

        const label = allTextElements.find(el => el.children.length === 0 && el.textContent.trim().toLowerCase() === 'alle sammeln');
        if (!label) {
            console.log('[LEF Auto Order] Keine ausstehenden Belohnungen ("Alle sammeln" nicht sichtbar).');
            return;
        }

        // Der "Alle sammeln" Button befindet sich in der gleichen Zeile/Spalte unter dem Label
        const parentRow = label.closest('.flex, div');
        const candidateBtns = Array.from(parentRow?.parentElement?.querySelectorAll('button') || parentRow?.querySelectorAll('button') || [])
            .filter(b => !b.closest('#headerBar') && !b.closest('.bb-filter-and-sort-bar'));

        const btn = candidateBtns[0];
        if (btn && !btn.disabled && !btn.hasAttribute('disabled')) {
            console.log('[LEF Auto Order] Belohnungen vorhanden -> Klicke auf "Alle sammeln":', btn.outerHTML.slice(0, 100));
            simulateClick(btn);
            await new Promise(r => setTimeout(r, 800));
        } else {
            console.log('[LEF Auto Order] Kein aktiver "Alle sammeln"-Button gefunden.');
        }
    }

    // =========================================================================
    // HAUPT-LOGIK (1-KLICK ASYNC FLOW)
    // =========================================================================

    async function executeAutoStart() {
        if (isAutoRunning) {
            console.log('[LEF Auto Order] Stop angefordert vom Benutzer!');
            showToast('Auto-Ablauf wird abgebrochen...');
            stopRequested = true;
            return;
        }

        // 1. Prüfen und ggf. zum Tab "Anfragen" wechseln
        const isOnAnfragen = await ensureAnfragenTab();
        if (!isOnAnfragen) {
            showToast('Bitte wähle zuerst den Filter "Anfragen" aus!');
            return;
        }

        isAutoRunning = true;
        stopRequested = false;
        updateAutoStartButtonState(true);

        try {
            console.log('[LEF Auto Order] Starte 1-Klick Auftragsbearbeitung...');

            // 2. Belohnungen einsammeln ("Alle sammeln", nur außerhalb der Filterleiste)
            await collectAllRewards();

            const processedKeys = new Set();
            const skippedKeys = new Set();
            let completedCount = 0;
            let consecutiveNoActionCount = 0;
            let premiumButtonChecked = false;

            while (!stopRequested) {
                // Alle aktuell im DOM sichtbaren Auftragskarten suchen
                const cards = Array.from(document.querySelectorAll('.bb-vl-item-slot-root, .panel[data-tutorial-id*="tradecenter"]'))
                    .filter(el => el.querySelector('img[src*="auto_select"], img[src*="start_transport"]'));

                // Erste Prüfung: Gibt es überhaupt 1-Klick-Buttons?
                if (!premiumButtonChecked && cards.length > 0) {
                    premiumButtonChecked = true;
                    const hasAny1ClickBtn = cards.some(c => get1ClickButton(c));
                    if (!hasAny1ClickBtn) {
                        console.warn('[LEF Auto Order] Kein 1-Klick-Button (Frau mit Helm) gefunden. Premium-Funktion aktiv?');
                        showToast('Keine 1-Klick-Buttons gefunden (nur für Premium-Nutzer).');
                        break;
                    }
                }

                let actionTakenInThisPass = false;

                for (const card of cards) {
                    if (stopRequested) break;

                    const key = getOrderKey(card);
                    if (!key || processedKeys.has(key) || skippedKeys.has(key)) {
                        continue;
                    }

                    // Kundenausschluss prüfen
                    if (shouldSkipOrder(card)) {
                        skippedKeys.add(key);
                        continue;
                    }

                    const autoBtn = get1ClickButton(card);
                    if (!autoBtn) {
                        skippedKeys.add(key);
                        continue;
                    }

                    const titleEl = card.querySelector('.order-header .text-h2, .text-h2');
                    const streetEl = card.querySelector('.order-header .text-p2-400, .text-p2-400');
                    const orderName = titleEl ? titleEl.textContent.trim() : 'Auftrag';
                    const streetName = streetEl ? streetEl.textContent.trim() : '';
                    const logFullName = streetName ? `${orderName} (${streetName})` : orderName;

                    if (is1ClickButtonEnabled(autoBtn)) {
                        console.log(`[LEF Auto Order] Starte 1-Klick für: ${logFullName}`);

                        simulateClick(autoBtn);
                        try { autoBtn.click(); } catch (_) {}

                        processedKeys.add(key);
                        completedCount++;
                        actionTakenInThisPass = true;
                        consecutiveNoActionCount = 0;

                        // Kurze Pause zur Verarbeitung durch das Spiel & DOM-Update
                        await new Promise(r => setTimeout(r, 400));
                        break; // Virtual-List DOM neu erfassen
                    } else {
                        // Button ist ausgegraut (Ware oder Fahrzeuge fehlen)
                        console.log(`[LEF Auto Order] Überspringe ${logFullName} (1-Klick ausgegraut: Ware oder Fahrzeuge fehlen)`);
                        skippedKeys.add(key);
                    }
                }

                if (!actionTakenInThisPass && !stopRequested) {
                    // Keine Aktion bei den aktuell sichtbaren Karten möglich.
                    // Versuche, in der Liste nach unten zu scrollen, um weitere Aufträge nachzuladen.
                    const scrollContainer = getScrollContainer();
                    const canScroll = scrollContainer && (scrollContainer.scrollTop + scrollContainer.clientHeight < scrollContainer.scrollHeight - 20);

                    if (canScroll) {
                        scrollContainer.scrollTop += 350;
                        scrollContainer.dispatchEvent(new Event('scroll'));
                        await new Promise(r => setTimeout(r, 400));
                    } else {
                        consecutiveNoActionCount++;
                        if (consecutiveNoActionCount >= 2) {
                            // Am Ende der Liste angekommen
                            break;
                        }
                        await new Promise(r => setTimeout(r, 300));
                    }
                }
            }

            // Nach Abschluss wieder nach oben scrollen
            const scrollContainer = getScrollContainer();
            if (scrollContainer) {
                scrollContainer.scrollTop = 0;
                scrollContainer.dispatchEvent(new Event('scroll'));
            }

            if (stopRequested) {
                console.log('[LEF Auto Order] Ablauf durch Benutzer gestoppt.');
                showToast('Auto-Ablauf gestoppt.');
            } else {
                console.log(`[LEF Auto Order] Fertig! ${completedCount} Aufträge gestartet, ${skippedKeys.size} übersprungen.`);
                showToast(`Fertig: ${completedCount} Aufträge erledigt (${skippedKeys.size} übersprungen).`);
            }

        } catch (e) {
            console.error('[LEF Auto Order] Fehler im Ablauf:', e);
            showToast('Fehler bei der Auftragsbearbeitung!');
        } finally {
            isAutoRunning = false;
            stopRequested = false;
            updateAutoStartButtonState(false);
        }
    }

    // =========================================================================
    // UI: AUTO-START BUTTON (HANDELSZENTRUM) & FLOATING STOP
    // =========================================================================

    function updateFloatingStopButton(running) {
        let btn = document.getElementById('lef-floating-stop-btn');

        if (!running) {
            if (btn) btn.remove();
            return;
        }

        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'lef-floating-stop-btn';
            btn.className = 'lea-floating-stop-btn';
            btn.textContent = '🛑 STOP Auto-Ablauf';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[LEF Auto Order] Stop angefordert über Floating Button!');
                showToast('Auto-Ablauf wird abgebrochen...');
                stopRequested = true;
                btn.textContent = 'Stoppt...';
                btn.classList.add('lea-btn-disabled');
            });

            document.body.appendChild(btn);
        }
    }

    function updateAutoStartButtonState(running) {
        const btn = document.getElementById(INJECT_BTN_ID);
        if (btn) {
            const inner = btn.querySelector('div');
            if (inner) {
                inner.innerHTML = running ? 'STOP' : 'Auto<br>Order';
                if (running) {
                    btn.classList.add('lea-btn-running');
                } else {
                    btn.classList.remove('lea-btn-running');
                }
            }
        }

        updateFloatingStopButton(running);
    }

    function injectAutoStartButton() {
        if (!isHandelszentrumOpen()) {
            const existing = document.getElementById(INJECT_BTN_ID);
            if (existing) existing.remove();
            return;
        }
        if (document.getElementById(INJECT_BTN_ID)) return;

        const headerContainer = document.querySelector('img[src*="page_header_orders-"]')?.closest('.flex.flex-nowrap.items-center')?.querySelector('.gap-md.flex');
        if (!headerContainer) return;

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md shape--square theme--light lea-injected-btn';
        if (isAutoRunning) {
            btn.classList.add('lea-btn-running');
        }
        btn.title = 'Startet/Stoppt die automatische 1-Klick Auftragsbearbeitung';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.innerHTML = isAutoRunning ? 'STOP' : 'Auto<br>Order';
        btn.appendChild(inner);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            executeAutoStart();
        });

        headerContainer.appendChild(btn);
        updateAutoStartButtonState(isAutoRunning);
    }

    // =========================================================================
    // INITIALISIERUNG
    // =========================================================================

    function init() {
        console.log('[LEF Auto Order] Initialisiert v1.2.0 (1-Klick Premium Flow)');

        injectAutoStartButton();

        // Klick-Listener für präemptive Sperre bei Klick auf automatische Fahrzeugauswahl im manuellen Modus
        document.addEventListener('click', (e) => {
            if (isAutoRunning) return;
            const btn = e.target.closest(ASSISTANT_BTN_SELECTOR);
            if (btn) {
                const img = btn.querySelector('img');
                const src = img ? img.getAttribute('src') || '' : '';
                if (src.includes(IMG_AUTO_SELECT)) {
                    preemptiveLockUntilTime = Date.now() + 1000;
                    autoSelectClickTime = Date.now();
                    waitingForDeliveryTime = true;
                    enableTransportButtons(false);
                    console.log('[LEF Safety Lock] Auto-Select geklickt. Buttons präemptiv gesperrt und Ladezustand aktiv.');
                }
            }
        }, true);

        // Passive Überprüfung der Lieferzeit für manuelles Spielen
        setInterval(passiveCheckDeliveryTime, 200);

        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    injectAutoStartButton();
                    isHandlingMutations = false;
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();