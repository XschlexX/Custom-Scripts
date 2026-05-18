// ==UserScript==
// @name         LEA Auto Order Assistant
// @namespace    le-tools
// @version      1.4.8
// @match        https://game.logistics-empire.com/*
// @description  Automatischer Assistent. On-Demand Ausführung über Button im Handelszentrum.
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-order.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-order.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & SELEKTOREN
    // =========================================================================
    const MAX_DELIVERY_TIME_MINUTES = 15; // Globale Konstante für die maximale Lieferzeit

    const ASSISTANT_BTN_SELECTOR = 'button[data-tutorial-id="transport-assistant"]';
    const ALL_REWARDS_BTN_SELECTOR = 'button.variant--normal img[src*="collect_order"]';
    const HANDELSZENTRUM_HEADER_SRC = 'img[src*="page_header_orders-"]';
    const FILTER_BAR_SELECTOR = '.bb-filter-and-sort-bar';
    const INJECT_BTN_ID = 'lef-auto-start-btn';

    let isAutoRunning = false;
    let stopRequested = false;

    // =========================================================================
    // HILFSFUNKTIONEN (Warten & Zeit)
    // =========================================================================

    async function waitForElementToAppear(selector, timeoutMs = 3000) {
        const startTime = Date.now();
        while (!document.querySelector(selector)) {
            if (Date.now() - startTime > timeoutMs) return false;
            await new Promise(r => setTimeout(r, 50));
        }
        return true;
    }

    async function waitForElementToDisappear(selector, timeoutMs = 3000) {
        const startTime = Date.now();
        while (document.querySelector(selector)) {
            if (Date.now() - startTime > timeoutMs) {
                console.warn(`[LEF Auto Assistant] Timeout: Element ${selector} ist nicht verschwunden.`);
                break;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    }

    function parseTimeToSeconds(timeStr) {
        let totalSeconds = 0;
        timeStr.trim().split(' ').forEach(part => {
            const value = parseInt(part);
            if (isNaN(value)) return;
            if (part.includes('h')) totalSeconds += value * 3600;
            else if (part.includes('m')) totalSeconds += value * 60;
            else if (part.includes('s')) totalSeconds += value;
        });
        return totalSeconds;
    }

    function getDeliveryTimeSeconds() {
        const match = (document.body.textContent || '').match(/Zeit ben[öo]tigt\s+((?:\d+\s*[hms]\s*){1,3})/i);
        if (match && match[1]) {
            return { seconds: parseTimeToSeconds(match[1]), timeString: match[1].trim() };
        }
        return null;
    }

    function isHandelszentrumOpen() {
        return !!document.querySelector(HANDELSZENTRUM_HEADER_SRC);
    }

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

    function passiveCheckDeliveryTime() {
        // Deaktiviere die Warnung, wenn das automatische Skript gerade arbeitet
        if (isAutoRunning) {
            showTimeWarning(false);
            return;
        }

        const pageText = document.body.textContent || '';
        const isVehicleWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität/);

        if (!isVehicleWindow) {
            showTimeWarning(false);
            return;
        }

        const result = getDeliveryTimeSeconds();
        if (result && result.seconds > MAX_DELIVERY_TIME_MINUTES * 60) {
            showTimeWarning(true, `Lieferzeit zu hoch! (${result.timeString})`);
        } else {
            showTimeWarning(false);
        }
    }

    // =========================================================================
    // UI: BENACHRICHTIGUNGEN (Toasts)
    // =========================================================================

    function showToast(msg) {
        const existing = document.getElementById('lef-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'lef-toast';
        toast.className = 'lea-toast';
        toast.textContent = msg;

        document.body.appendChild(toast);

        setTimeout(() => {
            const el = document.getElementById('lef-toast');
            if (el) {
                el.style.opacity = '0';
                setTimeout(() => {
                    if (document.getElementById('lef-toast') === el) el.remove();
                }, 300);
            }
        }, 2000);
    }

    // =========================================================================
    // HAUPT-LOGIK (ASYNC FLOW)
    // =========================================================================

    async function executeAutoStart() {
        if (isAutoRunning) {
            console.log('[LEF Auto Assistant] Stop angefordert vom Benutzer!');
            showToast('Auto-Ablauf wird abgebrochen...');
            stopRequested = true;
            return;
        }

        // 1. Prüfen, ob der "Anfragen" (Klemmbrett) Filter aktiv ist
        const anfragenTab = document.querySelector('button[aria-label="Anfragen"]');
        if (!anfragenTab || anfragenTab.getAttribute('active') !== 'true') {
            showToast('Bitte wähle zuerst den Filter "Anfragen" aus!');
            return; // Skript bricht hier ab, falls der falsche Filter aktiv ist
        }

        isAutoRunning = true;
        stopRequested = false;
        updateAutoStartButtonState(true);

        try {
            console.log('[LEF Auto Assistant] Starte manuellen Auto-Ablauf...');

            // 2. Belohnungen einsammeln ("Alle sammeln")
            const allCollectBtn = document.querySelector(ALL_REWARDS_BTN_SELECTOR)?.closest('button');
            if (allCollectBtn && allCollectBtn.offsetParent !== null && !allCollectBtn.hasAttribute('disabled')) {
                console.log('[LEF Auto Assistant] Klicke auf Alle sammeln...');
                allCollectBtn.click();
                await new Promise(r => setTimeout(r, 1000)); // Kurz warten, bis Server antwortet
            }

            // 3. Aufträge/Anfragen abarbeiten
            let hasMoreOrders = true;
            let skipIndex = 0;

            while (hasMoreOrders && !stopRequested) {
                // Wir warten kurz, falls die Liste nach dem letzten Auftrag neu geladen wird
                let nextOrderBtn = null;
                for (let retry = 0; retry < 10; retry++) { // Bis zu 5 Sekunden warten!
                    if (stopRequested) break;

                    // Wir suchen explizit nach den Buttons, die das "start_transport" Icon enthalten!
                    // Das ist die sicherste Methode, da das Bild eindeutig ist.
                    const availableBtns = Array.from(document.querySelectorAll('button img[src*="start_transport"]'))
                        .map(img => img.closest('button'))
                        .filter(btn => btn && !btn.hasAttribute('disabled'));

                    // Wir nehmen den Button an der Position skipIndex. 
                    if (availableBtns.length > skipIndex) {
                        nextOrderBtn = availableBtns[skipIndex];
                        break;
                    }
                    await new Promise(r => setTimeout(r, 500));
                }

                if (!nextOrderBtn || stopRequested) {
                    // Keine weiteren offenen Aufträge gefunden oder Stop
                    hasMoreOrders = false;
                    break;
                }

                console.log('[LEF Auto Assistant] Auftrag gefunden, betrete Auftrag (Klick auf Klemmbrett)...');
                nextOrderBtn.click();

                // Dynamisch warten, bis das Assistent-Fenster überhaupt offen ist
                await waitForElementToAppear(ASSISTANT_BTN_SELECTOR, 3000);

                let orderFinished = false;
                let stepCounter = 0;
                let abortOrder = false;

                while (!orderFinished && !abortOrder && stepCounter < 50 && !stopRequested) {
                    stepCounter++;
                    await new Promise(r => setTimeout(r, 50)); // Nur 50ms statt 500ms

                    // Suchen wir den Assistenten-Button (Frau oder Doppelpfeil)
                    const allBtns = Array.from(document.querySelectorAll(ASSISTANT_BTN_SELECTOR));
                    const currentBtn = allBtns.find(b => b.closest('.bottom-navigation') || b.closest('.bb-dialog'));

                    if (!currentBtn) {
                        // Wenn der Button weg ist, checken ob das Overlay zu ist
                        const hasOverlay = document.querySelector('.bottom-navigation');
                        if (!hasOverlay && stepCounter > 4) {
                            orderFinished = true; // Wir sind wieder im Hauptmenü
                        }
                        continue;
                    }

                    const src = currentBtn.querySelector('img')?.getAttribute('src') || '';
                    const pageText = document.body.textContent || '';
                    const isVehicleWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität/);

                    if (!isVehicleWindow) {
                        // Phase 1: Produktauswahl (Angeforderte Waren)
                        if (src.includes('auto_select')) {
                            console.log('[LEF Auto Assistant] Produktauswahl: Klicke Frau (Produkte automatisch wählen)...');
                            currentBtn.click();
                            // Dynamisch warten, bis Doppelpfeil erscheint
                            await waitForElementToAppear('button[data-tutorial-id="transport-assistant"] img[src*="button-continue"]', 2000);
                        } else if (src.includes('button-continue') || src.includes('in_progress')) {
                            console.log('[LEF Auto Assistant] Produktauswahl: Klicke Doppelpfeil (Weiter zur Fahrzeugauswahl)...');
                            currentBtn.click();
                            // Dynamisch warten, bis Frau im neuen Fenster erscheint
                            await waitForElementToAppear('button[data-tutorial-id="transport-assistant"] img[src*="auto_select"]', 2000);
                        }
                    } else {
                        // Phase 2: Fahrzeugauswahl
                        if (src.includes('auto_select')) {
                            console.log('[LEF Auto Assistant] Fahrzeugauswahl: Klicke Frau (Fahrzeug automatisch wählen)...');
                            currentBtn.click();
                            // Dynamisch warten, bis Doppelpfeil erscheint
                            await waitForElementToAppear('button[data-tutorial-id="transport-assistant"] img[src*="button-continue"]', 2000);
                        } else if (src.includes('button-continue') || src.includes('in_progress')) {
                            // Zeit dynamisch abfragen statt fix zu warten
                            let result = getDeliveryTimeSeconds();
                            let waitTime = 0;
                            while (!result && waitTime < 2000) {
                                await new Promise(r => setTimeout(r, 50));
                                waitTime += 50;
                                result = getDeliveryTimeSeconds();
                            }

                            if (!result) {
                                continue; // Warte weiter im Haupt-Loop
                            }

                            if (result.seconds > MAX_DELIVERY_TIME_MINUTES * 60) {
                                console.warn(`[LEF Auto Assistant] Lieferzeit zu lang (${result.timeString}). Breche ab und gehe zurück!`);
                                abortOrder = true;
                                break;
                            } else {
                                console.log('[LEF Auto Assistant] Lieferzeit OK. Klicke Doppelpfeil (Starten)!');
                                currentBtn.click();

                                // Warten, bis das Fenster komplett schließt
                                await waitForElementToDisappear(ASSISTANT_BTN_SELECTOR, 3000);
                                orderFinished = true;
                                break;
                            }
                        }
                    }
                }

                if (abortOrder || !orderFinished) {
                    if (!abortOrder) console.warn('[LEF Auto Assistant] Timeout im Auftrag. Breche ab...');
                    skipIndex++; // Diesen Auftrag nächstes Mal überspringen
                    await closeVehicleWindow();
                }
            }

            if (stopRequested) {
                console.log('[LEF Auto Assistant] Ablauf durch Benutzer gestoppt.');
                showToast('Auto-Ablauf gestoppt.');
            } else {
                console.log('[LEF Auto Assistant] Ablauf beendet.');
                showToast('Alle Aufträge erledigt.');
            }

        } catch (e) {
            console.error('[LEF Auto Assistant] Fehler im Ablauf:', e);
        } finally {
            isAutoRunning = false;
            stopRequested = false;
            updateAutoStartButtonState(false);
        }
    }

    async function closeVehicleWindow() {
        console.log('[LEF Auto Assistant] Schließe offene Unterfenster...');

        for (let i = 0; i < 4; i++) {
            // Prüfen, ob wir noch in einem der Unterfenster sind
            const pageText = document.body.textContent || '';
            const isSubWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität|Angeforderte Waren|Waren im Lager/);
            const hasAssistantBtn = !!document.querySelector('button[data-tutorial-id="transport-assistant"]');

            if (!isSubWindow && !hasAssistantBtn) {
                break; // Wir sind wieder im Hauptfenster
            }

            // Zurück-Button finden (Prio 1: spezieller Zurück-Button, Prio 2: erster Button unten)
            let closeBtn = document.querySelector('.bottom-navigation button.variant--nav');
            if (!closeBtn) {
                closeBtn = document.querySelector('.bottom-navigation button:first-child');
            }
            if (!closeBtn) {
                const btns = Array.from(document.querySelectorAll('button'));
                closeBtn = btns.find(b => {
                    const txt = (b.textContent || '').toLowerCase();
                    return txt.includes('schließen') || txt.includes('zurück');
                });
            }

            if (closeBtn) {
                console.log(`[LEF Auto Assistant] Klicke Zurück-Button (Schritt ${i + 1})...`);
                closeBtn.click();
                await new Promise(r => setTimeout(r, 600)); // Warte kurz auf die Schließen-Animation
            } else {
                console.warn('[LEF Auto Assistant] Keinen Zurück/Schließen-Button gefunden!');
                break;
            }
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
                console.log('[LEF Auto Assistant] Stop angefordert über Floating Button!');
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
                inner.textContent = running ? 'STOP' : 'Auto\nStart';
                if (running) {
                    btn.classList.add('lea-btn-running');
                } else {
                    btn.classList.remove('lea-btn-running');
                }
            }
        }

        // Auch den global schwebenden Button aktualisieren
        updateFloatingStopButton(running);
    }

    function injectAutoStartButton() {
        if (!isHandelszentrumOpen()) {
            const existing = document.getElementById(INJECT_BTN_ID);
            if (existing) existing.remove();
            return;
        }
        if (document.getElementById(INJECT_BTN_ID)) return;

        const filterBar = document.querySelector(FILTER_BAR_SELECTOR);
        if (!filterBar) return;

        // Finde das Such-Icon oben rechts
        const searchBtn = filterBar.querySelector('[data-tutorial-id="filter_by_search"]');
        if (!searchBtn) return;

        const searchContainer = searchBtn.closest('.relative');
        if (!searchContainer) return;

        // Erstelle den Button im gleichen Stil wie im Upgrade-Skript
        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md theme--light lea-injected-btn';
        btn.title = 'Startet/Stoppt die automatische Auftragsbearbeitung';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';

        btn.appendChild(inner);

        // Klick auf den Button startet oder stoppt den Async-Ablauf
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            executeAutoStart();
        });

        searchContainer.parentNode.insertBefore(btn, searchContainer);

        // Initiale Beschriftung setzen
        updateAutoStartButtonState(isAutoRunning);
    }

    // =========================================================================
    // INITIALISIERUNG
    // =========================================================================

    function init() {
        console.log('[LEF Auto Assistant] Initialisiert v1.4.8 (On-Demand Async Flow)');

        // Den alten Schalter und Menü-Reste vom alten Skript entfernen, falls das Skript ohne Neuladen überschrieben wurde
        const oldBtn = document.getElementById('lef-toggle-btn');
        if (oldBtn) oldBtn.remove();
        const oldAnfragenBtn = document.getElementById('lef-anfragen-custom-btn');
        if (oldAnfragenBtn) oldAnfragenBtn.remove();

        injectAutoStartButton();

        // Passive Überprüfung der Lieferzeit für manuelles Spielen (performant via Intervall)
        setInterval(passiveCheckDeliveryTime, 500);

        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    // Button reinwerfen, falls wir im Handelszentrum sind
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