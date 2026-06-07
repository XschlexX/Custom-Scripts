// ==UserScript==
// @name         LEA Auto Supply Refill
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.1.15
// @match        https://game.logistics-empire.com/*
// @description  Automatisiert das Auffüllen von Rohstofflagern für Fabriken mit (AF) Präfix.
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-supply-refill.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-supply-refill.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & ZUSTANDS-VARIABLEN
    // =========================================================================
    const INJECT_BTN_ID = 'lea-supply-refill-btn';
    const FLOATING_STOP_BTN_ID = 'lea-supply-floating-stop-btn';

    let isAutoRunning = false;
    let stopRequested = false;

    // =========================================================================
    // INITIALISIERUNG & ENTRY POINT
    // =========================================================================

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /**
     * Initialisiert das Userscript und startet den MutationObserver.
     */
    function init() {
        console.log('[LEA Auto Supply Refill] Initialisiert v1.1.13 (Voll-Automatikmodus)');
        injectStartButton();

        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    injectStartButton();
                    isHandlingMutations = false;
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Event-Listener für live Einstellungsänderungen
        document.addEventListener('lea-settings-changed', (e) => {
            const btn = document.getElementById(INJECT_BTN_ID);
            if (btn && e.detail && e.detail.buildingPrefix) {
                btn.title = `Automatischen Rohstoff-Nachschub für alle ${e.detail.buildingPrefix} Gebäude starten`;
                console.log('[LEA Auto Supply Refill] Button-Titel aktualisiert auf Prefix:', e.detail.buildingPrefix);
            }
        });
    }

    // =========================================================================
    // BUTTON INJEKTION & UI CONTROL
    // =========================================================================

    /**
     * Injiziert den "Auto Refill"-Button in das UI des Spiels, wenn man sich in der Gebäudeübersicht befindet.
     */
    function injectStartButton() {
        const isBuildingOverview = !!document.querySelector('[data-tutorial-id="filter_by_building_type"]');

        if (!isBuildingOverview) {
            const existing = document.getElementById(INJECT_BTN_ID);
            if (existing) existing.remove();
            return;
        }

        if (document.getElementById(INJECT_BTN_ID)) return;

        const blueprintBtn = document.querySelector('button[data-tutorial-id="building-list-item-add"]');

        if (!blueprintBtn) return;

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md shape--square theme--light lea-injected-btn';
        if (isAutoRunning) {
            btn.classList.add('lea-btn-running');
        }
        btn.title = `Automatischen Rohstoff-Nachschub für alle ${LEA_CONFIG.settings.buildingPrefix} Gebäude starten`;

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.innerHTML = isAutoRunning ? 'STOP' : 'Auto<br>Refill';
        btn.appendChild(inner);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isAutoRunning) {
                stopRequested = true;
            } else {
                executeAutoRefill();
            }
        });

        blueprintBtn.parentNode.insertBefore(btn, blueprintBtn);
    }

    /**
     * Aktualisiert den Status des Injektions-Buttons und des Floating-Stop-Buttons.
     * @param {boolean} running - Ob der Prozess aktuell läuft.
     */
    function updateStartButtonState(running) {
        const btn = document.getElementById(INJECT_BTN_ID);
        if (btn) {
            const inner = btn.querySelector('div');
            if (inner) {
                inner.innerHTML = running ? 'STOP' : 'Auto<br>Refill';
                if (running) {
                    btn.classList.add('lea-btn-running');
                } else {
                    btn.classList.remove('lea-btn-running');
                }
            }
        }
        updateFloatingStopButton(running);
    }

    /**
     * Erstellt oder entfernt den schwebenden Stop-Button.
     * @param {boolean} running - Ob der Prozess aktuell läuft.
     */
    function updateFloatingStopButton(running) {
        let btn = document.getElementById(FLOATING_STOP_BTN_ID);

        if (!running) {
            if (btn) btn.remove();
            return;
        }

        if (!btn) {
            btn = document.createElement('button');
            btn.id = FLOATING_STOP_BTN_ID;
            btn.className = 'lea-floating-stop-btn';
            btn.textContent = '🛑 STOP Auto Refill';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[LEA Supply Refill] Stop angefordert über Floating Button!');
                showToast('Ablauf wird abgebrochen...');
                stopRequested = true;
                btn.textContent = 'Stoppt...';
                btn.classList.add('lea-btn-disabled');
            });

            document.body.appendChild(btn);
        }
    }

    // =========================================================================
    // HAUPT-AUTOMATIONSLOOP
    // =========================================================================

    /**
     * Hauptfunktion zur Durchführung des automatischen Rohstoff-Auffüllens.
     * @returns {Promise<void>}
     */
    async function executeAutoRefill() {
        if (isAutoRunning) return;
        isAutoRunning = true;
        stopRequested = false;
        updateStartButtonState(true);
        showToast('Auto Refill gestartet...');

        const stats = {
            total: 0,
            refilled: 0,
            alreadyFull: 0,
            skippedTime: 0,
            failed: 0
        };

        try {
            // Suche einmalig am Start ausführen
            const searchSuccess = await triggerSearch(LEA_CONFIG.settings.buildingPrefix);
            if (!searchSuccess) {
                showToast('Fehler: Suche konnte nicht gestartet werden.');
                return;
            }

            // Warte bis Karten im DOM erscheinen
            await wait(400);

            let lastProcessedIndex = -1;
            let consecutiveFailures = 0;

            while (true) {
                if (stopRequested) break;

                const next = await waitForNextCard(lastProcessedIndex);
                if (!next) {
                    console.log(`[LEA Supply Refill] Kein höherer Index als ${lastProcessedIndex} gefunden. Ende der Liste.`);
                    break;
                }

                stats.total++;
                const result = await processBuildingCard(next);

                if (result === 'success') {
                    stats.refilled++;
                    consecutiveFailures = 0;
                } else if (result === 'already_full') {
                    stats.alreadyFull++;
                    consecutiveFailures = 0;
                } else if (result === 'skipped_time') {
                    stats.skippedTime++;
                    consecutiveFailures = 0;
                } else if (result === 'failed') {
                    stats.failed++;
                    consecutiveFailures = 0;
                } else if (result === 'load_error') {
                    stats.failed++;
                    consecutiveFailures++;
                    if (consecutiveFailures > 3) {
                        showToast('Fehler: Zu viele Ladefehler. Stoppe.');
                        break;
                    }
                } else if (result === 'stopped') {
                    stats.total--; // Nicht komplett bearbeitet
                    break;
                }

                lastProcessedIndex = next.index;
            }

            if (stopRequested) {
                showToast('Auto Refill gestoppt.');
            } else {
                showToast('Auto Refill abgeschlossen!');
            }

            if (stats.total > 0) {
                showRefillReportModal(stats);
            }

        } catch (e) {
            console.error('[LEA Supply Refill] Fehler im Hauptablauf:', e);
            showToast('Kritischer Fehler im Ablauf.');
        } finally {
            isAutoRunning = false;
            stopRequested = false;
            updateStartButtonState(false);
        }
    }

    // =========================================================================
    // ASSISTENTEN-KLICK-LOGIK
    // =========================================================================

    /**
     * Führt die Assistenten-Durchklick-Logik zum automatischen Bestellen von Ressourcen aus.
     * @returns {Promise<{status: string}>} Das Resultat der Aktion ('success', 'failed', 'skipped_time', 'stopped').
     */
    async function runTransportAssistantRefill() {
        console.log('[LEA Supply Refill] Starte Assistenten-Durchklick-Logik...');
        let stepCount = 0;

        while (stepCount < 15) {
            if (stopRequested) return { status: 'stopped' };

            const currentBtn = document.querySelector(LEA_CONFIG.ASSISTANT_BTN_SELECTOR);
            if (!currentBtn) {
                return { status: 'success' };
            }

            const src = currentBtn.querySelector('img')?.getAttribute('src') || '';
            const pageText = document.body.textContent || '';
            const isVehicleWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität/);

            if (!isVehicleWindow) {
                // Phase 1: Produktauswahl
                if (src.includes(LEA_CONFIG.IMG_AUTO_SELECT)) {
                    console.log('[LEA Supply Refill] Phase 1: Klicke Frau (Produkte automatisch wählen)...');
                    simulateClick(currentBtn);
                    await waitForElementToAppear(`${LEA_CONFIG.ASSISTANT_BTN_SELECTOR} img[src*="${LEA_CONFIG.IMG_IN_PROGRESS}"]`, 2000);
                } else if (src.includes(LEA_CONFIG.IMG_IN_PROGRESS)) {
                    console.log('[LEA Supply Refill] Phase 1: Klicke Doppelpfeil (Weiter)...');
                    simulateClick(currentBtn);
                    await waitForElementToAppear(`${LEA_CONFIG.ASSISTANT_BTN_SELECTOR} img[src*="${LEA_CONFIG.IMG_AUTO_SELECT}"]`, 2000);
                }
            } else {
                // Phase 2: Fahrzeugauswahl (inklusive Zeit-Check!)
                if (src.includes(LEA_CONFIG.IMG_AUTO_SELECT)) {
                    console.log('[LEA Supply Refill] Phase 2: Klicke Frau (Fahrzeuge automatisch wählen)...');
                    simulateClick(currentBtn);
                    await waitForElementToAppear(`${LEA_CONFIG.ASSISTANT_BTN_SELECTOR} img[src*="${LEA_CONFIG.IMG_IN_PROGRESS}"]`, 2000);
                } else if (src.includes(LEA_CONFIG.IMG_IN_PROGRESS)) {
                    let timeResult = getDeliveryTimeSeconds();
                    let waitTime = 0;
                    while (!timeResult && waitTime < 2000) {
                        await wait(50);
                        waitTime += 50;
                        timeResult = getDeliveryTimeSeconds();
                    }

                    if (!timeResult) {
                        console.log('[LEA Supply Refill] Lieferzeit konnte nicht gelesen werden, starte Transport...');
                    } else if (timeResult.seconds > LEA_CONFIG.settings.maxDeliveryTimeMinutes * 60) {
                        console.warn(`[LEA Supply Refill] Lieferzeit zu lang (${timeResult.timeString} > ${LEA_CONFIG.settings.maxDeliveryTimeMinutes} Min). Breche ab!`);
                        showToast(`Zeit zu lang (${timeResult.timeString}). Übersprungen!`);
                        return { status: 'skipped_time' };
                    } else {
                        console.log(`[LEA Supply Refill] Lieferzeit OK (${timeResult.timeString}). Starte Transport...`);
                    }

                    simulateClick(currentBtn);
                    await waitForElementToDisappear(LEA_CONFIG.ASSISTANT_BTN_SELECTOR, 3000);
                    return { status: 'success' };
                }
            }

            await wait(200);
            stepCount++;
        }

        return { status: 'failed' };
    }

    // =========================================================================
    // HILFSFUNKTIONEN FÜR EINZELSCHRITTE (NAVIGATION & DOM)
    // =========================================================================

    /**
     * Wartet darauf, dass eine Gebäudekarte mit einem höheren Index als dem zuletzt verarbeiteten sichtbar wird.
     * @param {number} lastProcessedIndex - Der Index des zuletzt erfolgreich verarbeiteten Gebäudes.
     * @returns {Promise<object|null>} Die nächste Gebäudekarte oder null, falls das Timeout erreicht wurde.
     */
    async function waitForNextCard(lastProcessedIndex) {
        let indexedAfCards = [];
        const startLoadTime = Date.now();
        while (Date.now() - startLoadTime < 4000) {
            indexedAfCards = getIndexedAfCards();
            const hasNext = indexedAfCards.some(item => item.index > lastProcessedIndex);
            if (hasNext) break;
            await wait(100);
        }
        return indexedAfCards.find(item => item.index > lastProcessedIndex) || null;
    }

    /**
     * Verarbeitet ein einzelnes Gebäude (betritt es, prüft Bedarf, fordert ggf. Rohstoffe an).
     * @param {object} next - Das zu verarbeitende Gebäude ({ index, card }).
     * @returns {Promise<string>} Der Status der Verarbeitung ('success', 'already_full', 'skipped_time', 'failed', 'load_error', 'stopped').
     */
    async function processBuildingCard(next) {
        console.log(`[LEA Supply Refill] Betrete Gebäude #${next.index}...`);

        // Pfeil-Button finden
        const arrowBtn = next.card.querySelector('img[src*="to_quest_objective"]')?.closest('button');
        if (!arrowBtn) {
            console.warn(`[LEA Supply Refill] Kein Pfeil-Button für Index ${next.index}. Überspringe...`);
            return 'failed';
        }

        simulateClick(arrowBtn);

        // Warten auf Laden der Fabrikübersicht
        const loaded = await waitForFactoryToLoad(4000);
        if (!loaded) {
            console.error('[LEA Supply Refill] Ladezeit der Fabrik überschritten.');
            await goBack();
            return 'load_error';
        }
        await wait(400); // Kurzer Rendering-Puffer

        // "Intern anfordern" Button suchen
        const internBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Intern anfordern'));

        if (!internBtn) {
            console.log('[LEA Supply Refill] Kein "Intern anfordern" Button. Gehe zurück.');
            await goBack();
            return 'already_full';
        }

        const isDisabled = internBtn.disabled || internBtn.getAttribute('disabled') !== null || internBtn.classList.contains('is-disabled');

        if (isDisabled) {
            console.log('[LEA Supply Refill] Gebäude benötigt keinen Nachschub (ausgegraut).');
            await goBack();
            return 'already_full';
        }

        // Wenn aktiv, klicke "Intern anfordern"
        console.log('[LEA Supply Refill] Nachschub benötigt! Klicke Intern anfordern...');
        simulateClick(internBtn);

        // Warten auf Assistent
        const assistantOpened = await waitForElementToAppear(LEA_CONFIG.ASSISTANT_BTN_SELECTOR, 4000);
        if (!assistantOpened) {
            console.warn('[LEA Supply Refill] Transport-Assistent nicht erschienen.');
            await goBack();
            return 'failed';
        }

        // Transport-Assistent Klick-Logik ausführen
        const refillResult = await runTransportAssistantRefill();

        if (refillResult.status === 'success') {
            console.log('[LEA Supply Refill] Transport erfolgreich gestartet!');
            await wait(600);
            await goBack();
            await wait(500);
            return 'success';
        } else {
            console.log('[LEA Supply Refill] Transport abgebrochen.');
            const status = refillResult.status; // 'skipped_time', 'stopped', oder 'failed'

            await navigateBackToBuildingOverview();

            return status;
        }
    }

    /**
     * Startet eine Suche nach dem angegebenen Begriff über das Suchfeld im Spiel.
     * @param {string} term - Der Suchbegriff (z. B. "(AF)").
     * @returns {Promise<boolean>} Gibt true zurück, wenn die Suche erfolgreich gestartet wurde.
     */
    async function triggerSearch(term) {
        console.log(`[LEA Supply Refill] Starte Suche nach: ${term}`);

        let searchInput = document.querySelector('input[placeholder*="Suche"], input[placeholder*="Name"], .bb-filter-and-sort-bar input');

        if (!searchInput) {
            const searchBtn = document.querySelector('[data-tutorial-id="filter_by_search"]');
            if (searchBtn) {
                simulateClick(searchBtn);
                await waitForElementToAppear('input', 1500);
                searchInput = document.querySelector('input');
            }
        }

        if (searchInput) {
            if (searchInput.value.trim().toUpperCase() === term.toUpperCase()) {
                return true;
            }

            searchInput.focus();
            searchInput.value = term;

            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            searchInput.blur();

            await wait(400); // Erhöhtes Warten für reibungsloses Filtern
            return true;
        }

        console.warn('[LEA Supply Refill] Suchfeld konnte nicht geöffnet werden.');
        return false;
    }

    /**
     * Liest alle sichtbaren (AF)-Gebäudekarten aus dem Virtual-Scroll-DOM aus.
     * Nutzt das data-index Attribut der virtuellen Listenzeilen als absolute Position.
     * Gibt ein nach index sortiertes Array zurück: [{ index, card }]
     */
    function getIndexedAfCards() {
        return Array.from(document.querySelectorAll('[data-index]'))
            .map(el => ({
                index: parseInt(el.getAttribute('data-index'), 10),
                card: el.querySelector('[class*="building-card"]')
            }))
            .filter(item =>
                !isNaN(item.index) &&
                item.card !== null &&
                item.card.textContent.toUpperCase().includes(LEA_CONFIG.settings.buildingPrefix.toUpperCase())
            )
            .sort((a, b) => a.index - b.index);
    }

    /**
     * Wartet darauf, dass die Fabrikübersichtsseite vollständig geladen wird.
     * @param {number} [timeoutMs=4000] - Maximales Timeout in Millisekunden.
     * @returns {Promise<boolean>} Gibt true zurück, wenn die Seite geladen wurde.
     */
    async function waitForFactoryToLoad(timeoutMs = 4000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const hasInternBtn = Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Intern anfordern') || b.textContent.includes('Extern kaufen'));
            const backBtn = document.querySelector('.bottom-navigation button[show-divider]') || document.querySelector('.bottom-navigation button:first-child');
            if (hasInternBtn && backBtn) {
                return true;
            }
            await wait(50);
        }
        return false;
    }

    /**
     * Navigiert schrittweise zurück zur Gebäudeübersicht, indem wiederholt der Zurück-Button geklickt wird.
     * Stoppt, sobald der Filter-Button der Gebäudeübersicht im DOM erkannt wird.
     * @param {number} [maxSteps=6] - Maximale Anzahl an Zurück-Klicks als Sicherheitslimit.
     * @returns {Promise<boolean>} true, wenn die Gebäudeübersicht erreicht wurde.
     */
    async function navigateBackToBuildingOverview(maxSteps = 6) {
        console.log('[LEA Supply Refill] Navigiere zurück zur Gebäudeübersicht...');

        for (let i = 0; i < maxSteps; i++) {
            // Prüfe ob wir bereits in der Gebäudeübersicht sind
            if (document.querySelector('[data-tutorial-id="filter_by_building_type"]')) {
                console.log('[LEA Supply Refill] Gebäudeübersicht erreicht.');
                return true;
            }

            const backClicked = await goBack();
            if (!backClicked) {
                console.warn('[LEA Supply Refill] Kein Zurück-Button gefunden, Abbruch der Navigation.');
                return false;
            }
        }

        const arrived = !!document.querySelector('[data-tutorial-id="filter_by_building_type"]');
        if (!arrived) {
            console.warn('[LEA Supply Refill] Gebäudeübersicht nach maxSteps nicht erreicht!');
        }
        return arrived;
    }

    /**
     * Klickt auf den Zurück-Button, um zur vorherigen Ansicht zu gelangen.
     * @returns {Promise<boolean>} Gibt true zurück, wenn der Button geklickt wurde.
     */
    async function goBack() {
        const backBtn = document.querySelector('.bottom-navigation button[show-divider]') ||
            document.querySelector('.bottom-navigation button:first-child') ||
            document.querySelector('button.variant--neutral img[src*="arrow-back"]')?.closest('button');
        if (backBtn) {
            console.log('[LEA Supply Refill] Klicke Zurück-Button...');
            simulateClick(backBtn);
            await wait(600);
            return true;
        }
        console.warn('[LEA Supply Refill] Zurück-Button nicht gefunden!');
        return false;
    }

    // =========================================================================
    // UI: REPORT / STATISTIK MODAL
    // =========================================================================

    /**
     * Zeigt das Statistik-Modal am Ende des Durchlaufs an.
     * @param {object} stats - Statistiken des Durchlaufs.
     * @param {number} stats.total - Gesamt geprüfte Gebäude.
     * @param {number} stats.refilled - Erfolgreich aufgefüllte Gebäude.
     * @param {number} stats.alreadyFull - Bereits volle Gebäude.
     * @param {number} stats.skippedTime - Aufgrund zu langer Lieferzeit übersprungene Gebäude.
     * @param {number} stats.failed - Fehlerhafte Gebäude.
     */
    function showRefillReportModal(stats) {
        // Altes Modal entfernen falls vorhanden
        const existing = document.getElementById('lea-refill-report-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'lea-refill-report-modal';
        overlay.className = 'lea-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'lea-modal';

        const title = document.createElement('h3');
        title.className = 'lea-modal-title';
        title.textContent = '🔄 Auto Refill Report';
        modal.appendChild(title);

        const list = document.createElement('div');
        list.className = 'lea-modal-list';

        const items = [
            { label: 'Gesamt geprüfte Gebäude', value: stats.total, color: '#f7fafc', icon: '🏢' },
            { label: 'Erfolgreich aufgefüllt', value: stats.refilled, color: '#4ade80', icon: '✅' },
            { label: 'Bereits voll / kein Bedarf', value: stats.alreadyFull, color: '#94a3b8', icon: '⚪' },
            { label: 'Übersprungen (Zeit zu lang)', value: stats.skippedTime, color: '#fbbf24', icon: '⏳' }
        ];

        if (stats.failed > 0) {
            items.push({ label: 'Fehlerhaft / Ladefehler', value: stats.failed, color: '#f87171', icon: '⚠️' });
        }

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'lea-modal-row';

            const labelSpan = document.createElement('span');
            labelSpan.className = 'lea-modal-label';
            labelSpan.innerHTML = `<span>${item.icon}</span> <span>${item.label}</span>`;

            const valSpan = document.createElement('span');
            valSpan.className = 'lea-modal-value';
            valSpan.style.color = item.color;
            valSpan.textContent = item.value;

            row.appendChild(labelSpan);
            row.appendChild(valSpan);
            list.appendChild(row);
        });

        modal.appendChild(list);

        const btnContainer = document.createElement('div');
        btnContainer.className = 'lea-modal-btn-container';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'lea-modal-close-btn';
        closeBtn.textContent = 'Schließen';
        closeBtn.addEventListener('click', () => {
            overlay.remove();
        });

        btnContainer.appendChild(closeBtn);
        modal.appendChild(btnContainer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

})();
