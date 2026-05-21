// ==UserScript==
// @name         LEA Auto Supply Refill
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.1.1
// @match        https://game.logistics-empire.com/*
// @description  Automatisiert das Auffüllen von Rohstofflagern für Fabriken mit (AF) Präfix.
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-supply-refill.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-supply-refill.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & SELEKTOREN
    // =========================================================================
    const MAX_DELIVERY_TIME_MINUTES = 15; // Maximale Lieferzeit in Minuten
    const FILTER_BAR_SELECTOR = '.bb-filter-and-sort-bar';
    const INJECT_BTN_ID = 'lea-supply-refill-btn';
    const FLOATING_STOP_BTN_ID = 'lea-supply-floating-stop-btn';

    let isAutoRunning = false;
    let stopRequested = false;

    // =========================================================================
    // HILFSFUNKTIONEN (Warten & Zeit)
    // =========================================================================

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitForElementToAppear(selector, timeoutMs = 3000) {
        const startTime = Date.now();
        while (!document.querySelector(selector)) {
            if (Date.now() - startTime > timeoutMs) return false;
            await wait(50);
        }
        return true;
    }

    async function waitForElementToDisappear(selector, timeoutMs = 3000) {
        const startTime = Date.now();
        while (document.querySelector(selector)) {
            if (Date.now() - startTime > timeoutMs) {
                console.warn(`[LEA Supply Refill] Timeout: Element ${selector} ist nicht verschwunden.`);
                break;
            }
            await wait(50);
        }
    }

    function simulateClick(element) {
        if (!element) return;
        ['mousedown', 'mouseup', 'click'].forEach(eventType => {
            element.dispatchEvent(new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        });
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

    // =========================================================================
    // UI: TOAST OVERLAY
    // =========================================================================

    function showToast(msg) {
        const existing = document.getElementById('lea-supply-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'lea-supply-toast';
        toast.className = 'lea-toast';
        toast.textContent = msg;

        document.body.appendChild(toast);

        setTimeout(() => {
            const el = document.getElementById('lea-supply-toast');
            if (el) {
                el.style.opacity = '0';
                setTimeout(() => {
                    if (document.getElementById('lea-supply-toast') === el) el.remove();
                }, 300);
            }
        }, 2500);
    }

    // =========================================================================
    // NAVIGATIONS-HILFEN (Suchen & Zurückgehen)
    // =========================================================================

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
            if (searchInput.value === term) {
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

    async function closeVehicleWindow() {
        console.log('[LEA Supply Refill] Schließe offene Unterfenster...');
        for (let i = 0; i < 4; i++) {
            const pageText = document.body.textContent || '';
            const isSubWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität|Angeforderte Waren|Waren im Lager/);
            const hasAssistantBtn = !!document.querySelector('button[data-tutorial-id="transport-assistant"]');

            if (!isSubWindow && !hasAssistantBtn) {
                break;
            }

            const closeBtn = document.querySelector('button.variant--neutral img[src*="arrow-back"], button.variant--neutral img[src*="close"]')?.closest('button');
            if (closeBtn) {
                simulateClick(closeBtn);
                await wait(300);
            } else {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
                await wait(300);
            }
        }
    }

    // =========================================================================
    // ASSISTENTEN-KLICK-LOGIK
    // =========================================================================

    async function runTransportAssistantRefill() {
        console.log('[LEA Supply Refill] Starte Assistenten-Durchklick-Logik...');
        let stepCount = 0;
        let abortRefill = false;
        let isTimeTooLong = false;

        while (stepCount < 15) {
            if (stopRequested) return { status: 'stopped' };

            const currentBtn = document.querySelector('button[data-tutorial-id="transport-assistant"]');
            if (!currentBtn) {
                return { status: abortRefill ? (isTimeTooLong ? 'skipped_time' : 'failed') : 'success' };
            }

            const src = currentBtn.querySelector('img')?.getAttribute('src') || '';
            const pageText = document.body.textContent || '';
            const isVehicleWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität/);

            if (!isVehicleWindow) {
                // Phase 1: Produktauswahl
                if (src.includes('auto_select')) {
                    console.log('[LEA Supply Refill] Phase 1: Klicke Frau (Produkte automatisch wählen)...');
                    simulateClick(currentBtn);
                    await waitForElementToAppear('button[data-tutorial-id="transport-assistant"] img[src*="button-continue"]', 2000);
                } else if (src.includes('button-continue')) {
                    console.log('[LEA Supply Refill] Phase 1: Klicke Doppelpfeil (Weiter)...');
                    simulateClick(currentBtn);
                    await waitForElementToAppear('button[data-tutorial-id="transport-assistant"] img[src*="auto_select"]', 2000);
                }
            } else {
                // Phase 2: Fahrzeugauswahl (inklusive Zeit-Check!)
                if (src.includes('auto_select')) {
                    console.log('[LEA Supply Refill] Phase 2: Klicke Frau (Fahrzeuge automatisch wählen)...');
                    simulateClick(currentBtn);
                    await waitForElementToAppear('button[data-tutorial-id="transport-assistant"] img[src*="button-continue"]', 2000);
                } else if (src.includes('button-continue')) {
                    let timeResult = getDeliveryTimeSeconds();
                    let waitTime = 0;
                    while (!timeResult && waitTime < 2000) {
                        await wait(50);
                        waitTime += 50;
                        timeResult = getDeliveryTimeSeconds();
                    }

                    if (!timeResult) {
                        console.log('[LEA Supply Refill] Lieferzeit konnte nicht gelesen werden, starte Transport...');
                    } else if (timeResult.seconds > MAX_DELIVERY_TIME_MINUTES * 60) {
                        console.warn(`[LEA Supply Refill] Lieferzeit zu lang (${timeResult.timeString} > ${MAX_DELIVERY_TIME_MINUTES} Min). Breche ab!`);
                        showToast(`Zeit zu lang (${timeResult.timeString}). Übersprungen!`);
                        abortRefill = true;
                        isTimeTooLong = true;
                        break;
                    } else {
                        console.log(`[LEA Supply Refill] Lieferzeit OK (${timeResult.timeString}). Starte Transport...`);
                    }

                    simulateClick(currentBtn);
                    await waitForElementToDisappear('button[data-tutorial-id="transport-assistant"]', 3000);
                    return { status: abortRefill ? (isTimeTooLong ? 'skipped_time' : 'failed') : 'success' };
                }
            }

            await wait(200);
            stepCount++;
        }

        return { status: abortRefill ? (isTimeTooLong ? 'skipped_time' : 'failed') : 'failed' };
    }

    // =========================================================================
    // UI: STATISTIK MODAL AM SCHLUSS
    // =========================================================================

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

    // =========================================================================
    // HAUPT-AUTOMATIONSLOOP
    // =========================================================================

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
            const searchSuccess = await triggerSearch('(AF)');
            if (!searchSuccess) {
                showToast('Fehler: Suche konnte nicht gestartet werden.');
                return;
            }

            let currentIndex = 0;
            let consecutiveFailures = 0;

            while (true) {
                if (stopRequested) break;

                // Suche aktualisieren und Liste neu einlesen (wegen Virtual Scrolling und Navigations-Resets)
                await triggerSearch('(AF)');
                await wait(200);

                const cards = Array.from(document.querySelectorAll('[class*="building-card"]'));
                const afCards = cards.filter(card => {
                    const text = card.textContent || '';
                    return text.includes('(AF)');
                });

                console.log(`[LEA Supply Refill] Gefundene (AF)-Gebäude: ${afCards.length}, aktueller Index: ${currentIndex}`);

                if (currentIndex >= afCards.length) {
                    console.log('[LEA Supply Refill] Alle Gebäude abgearbeitet.');
                    break;
                }

                stats.total++;
                const currentCard = afCards[currentIndex];

                // Pfeil-Button finden
                const arrowBtn = currentCard.querySelector('img[src*="to_quest_objective"]')?.closest('button');
                if (!arrowBtn) {
                    console.warn(`[LEA Supply Refill] Kein Pfeil-Button für Gebäude an Index ${currentIndex} gefunden. Überspringe...`);
                    stats.failed++;
                    currentIndex++;
                    continue;
                }

                // In das Gebäude reingehen
                console.log(`[LEA Supply Refill] Betrete Gebäude ${currentIndex + 1}/${afCards.length}...`);
                currentCard.scrollIntoView({ block: 'center' });
                await wait(100);
                simulateClick(arrowBtn);

                // Warten auf Laden der Fabrikübersicht
                const loaded = await waitForFactoryToLoad(4000);
                if (!loaded) {
                    console.error('[LEA Supply Refill] Ladezeit der Fabrik überschritten.');
                    consecutiveFailures++;
                    stats.failed++;
                    if (consecutiveFailures > 3) {
                        showToast('Fehler: Zu viele Ladefehler. Stoppe.');
                        break;
                    }
                    await goBack();
                    currentIndex++;
                    continue;
                }
                consecutiveFailures = 0;
                await wait(400); // Kurzer Rendering-Puffer

                // "Intern anfordern" Button suchen
                const internBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Intern anfordern'));

                if (!internBtn) {
                    console.log('[LEA Supply Refill] Kein Button "Intern anfordern" gefunden. Gehe zurück.');
                    stats.alreadyFull++;
                    await goBack();
                    currentIndex++;
                    continue;
                }

                const isDisabled = internBtn.disabled || internBtn.getAttribute('disabled') !== null || internBtn.classList.contains('is-disabled');

                if (isDisabled) {
                    console.log(`[LEA Supply Refill] Gebäude ${currentIndex + 1} benötigt keinen Nachschub (ausgegraut).`);
                    stats.alreadyFull++;
                    await goBack();
                    currentIndex++;
                    continue;
                }

                // Wenn aktiv, klicke "Intern anfordern"
                console.log('[LEA Supply Refill] Nachschub benötigt! Klicke Intern anfordern...');
                simulateClick(internBtn);

                // Warten auf Assistent
                const assistantOpened = await waitForElementToAppear('button[data-tutorial-id="transport-assistant"]', 4000);
                if (!assistantOpened) {
                    console.warn('[LEA Supply Refill] Transport-Assistent nicht erschienen.');
                    stats.failed++;
                    await goBack();
                    currentIndex++;
                    continue;
                }

                // Transport-Assistent Klick-Logik ausführen
                const refillResult = await runTransportAssistantRefill();

                if (refillResult.status === 'success') {
                    console.log('[LEA Supply Refill] Transport erfolgreich gestartet!');
                    stats.refilled++;
                    await wait(600);
                } else {
                    console.log('[LEA Supply Refill] Transport abgebrochen.');
                    if (refillResult.status === 'skipped_time') {
                        stats.skippedTime++;
                    } else if (refillResult.status === 'stopped') {
                        stats.total--; // Nicht komplett bearbeitet
                        await closeVehicleWindow();
                        await wait(300);
                        await goBack();
                        break;
                    } else {
                        stats.failed++;
                    }
                    await closeVehicleWindow();
                    await wait(300);
                }

                // Zurück zur Gebäudeübersicht
                await goBack();
                await wait(500);

                currentIndex++;
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
    // START/STOP BUTTON INJEKTION
    // =========================================================================

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
        btn.title = 'Automatischen Rohstoff-Nachschub für alle (AF) Gebäude starten';

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

    // =========================================================================
    // INIT & OBSERVER
    // =========================================================================

    function init() {
        console.log('[LEA Auto Supply Refill] Initialisiert v1.0.4 (Voll-Automatikmodus)');
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
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
