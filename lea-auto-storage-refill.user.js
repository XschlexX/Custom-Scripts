// ==UserScript==
// @name         LEA Auto Storage Refill
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.0.1
// @match        https://game.logistics-empire.com/*
// @description  Automatisiert das Befüllen von Zwischenlagern (Präfix (LS)) über das Auto Fill Goods Skript.
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js?v=1.0.12
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-storage-refill.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-storage-refill.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & ZUSTANDS-VARIABLEN
    // =========================================================================
    const INJECT_BTN_ID = 'lea-storage-refill-btn';
    const FLOATING_STOP_BTN_ID = 'lea-storage-floating-stop-btn';

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
        console.log('[LEA Auto Storage Refill] Initialisiert v1.0.1 (Lager-Automatik)');
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
            if (btn && e.detail && e.detail.storagePrefix) {
                btn.title = `Automatische Lager-Auffüllung für alle ${e.detail.storagePrefix} Gebäude starten`;
                console.log('[LEA Auto Storage Refill] Button-Titel aktualisiert auf Prefix:', e.detail.storagePrefix);
            }
        });
    }

    // =========================================================================
    // BUTTON INJEKTION & UI CONTROL
    // =========================================================================

    /**
     * Injiziert den "Auto Fill"-Button in das UI des Spiels (in die Gebäudeübersicht).
     */
    function injectStartButton() {
        const isBuildingOverview = !!document.querySelector('[data-tutorial-id="filter_by_building_type"]');

        if (!isBuildingOverview) {
            const existing = document.getElementById(INJECT_BTN_ID);
            if (existing) existing.remove();
            return;
        }

        if (document.getElementById(INJECT_BTN_ID)) return;

        // Versuche den Auto-Refill-Button zu finden, um uns daneben zu platzieren
        const supplyBtn = document.getElementById('lea-supply-refill-btn');
        const blueprintBtn = document.querySelector('button[data-tutorial-id="building-list-item-add"]');

        if (!blueprintBtn && !supplyBtn) return;

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md shape--square theme--light lea-injected-btn';
        if (isAutoRunning) {
            btn.classList.add('lea-btn-running');
        }
        btn.title = `Automatische Lager-Auffüllung für alle ${LEA_CONFIG.settings.storagePrefix} Gebäude starten`;

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.innerHTML = isAutoRunning ? 'STOP' : 'Auto<br>Fill';
        btn.appendChild(inner);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isAutoRunning) {
                stopRequested = true;
            } else {
                executeStorageRefill();
            }
        });

        // Wenn der Auto-Supply-Button da ist, setzen wir uns links daneben, sonst neben den Blueprint-Button
        if (supplyBtn) {
            supplyBtn.parentNode.insertBefore(btn, supplyBtn);
        } else {
            blueprintBtn.parentNode.insertBefore(btn, blueprintBtn);
        }
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
                inner.innerHTML = running ? 'STOP' : 'Auto<br>Fill';
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
            btn.textContent = '🛑 STOP Auto Fill';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[LEA Storage Refill] Stop angefordert über Floating Button!');
                showToast('Lager-Befüllung wird abgebrochen...');
                stopRequested = true;
                btn.textContent = 'Stoppt...';
                btn.classList.add('lea-btn-disabled');
            });

            document.body.appendChild(btn);
        }
    }

    // =========================================================================
    // HILFSFUNKTIONEN FÜR GEBÄUDEAUSWERTUNG
    // =========================================================================

    /**
     * Hilfsfunktion zum Parsen von Füllstandszahlen (z.B. "366" oder "4.000").
     */
    function parseLocalStorageNumber(str) {
        if (!str) return 0;
        // Punkte entfernen (Tausendertrenner) und Kommas durch Punkte ersetzen
        str = str.replace(/\./g, '').replace(/,/g, '.');
        return parseFloat(str) || 0;
    }

    /**
     * Analysiert eine Gebäudekarte auf der Übersicht und prüft, ob das Lager leer genug ist.
     * @param {HTMLElement} card - Die Gebäudekarte im DOM.
     * @param {number} minEmptyPercentage - Der konfigurierte Grenzwert.
     * @returns {boolean} True, wenn das Lager zu mindestens minEmptyPercentage leer ist.
     */
    function isStorageEmptyEnough(card, minEmptyPercentage) {
        if (!card) return false;

        const labelContainers = Array.from(card.querySelectorAll('.bb-label-container'));
        const storageLabel = labelContainers.find(el => {
            const text = el.textContent.toLowerCase();
            return text.includes('lager voll') || text.includes('frei');
        });

        if (!storageLabel) {
            console.log('[LEA Storage Refill] Kein Lager-Statuslabel auf der Kachel gefunden. Betrete zur Sicherheit.');
            return true;
        }

        const text = storageLabel.textContent.trim();
        if (text.toLowerCase().includes('lager voll')) {
            console.log('[LEA Storage Refill] Lager ist voll (0% frei). Überspringe.');
            return false;
        }

        const match = text.match(/([\d.,]+)\s*\/\s*([\d.,]+)\s*Frei/i);
        if (match) {
            const freeAmount = parseLocalStorageNumber(match[1]);
            const totalCapacity = parseLocalStorageNumber(match[2]);
            
            if (totalCapacity > 0) {
                const freePercentage = (freeAmount / totalCapacity) * 100;
                const matchesMinLimit = freePercentage >= minEmptyPercentage;
                console.log(`[LEA Storage Refill] Lager-Status: ${freeAmount}/${totalCapacity} Frei (${freePercentage.toFixed(1)}%). Benötigt: ${minEmptyPercentage}% -> ${matchesMinLimit ? 'Befüllen!' : 'Überspringen'}`);
                return matchesMinLimit;
            }
        }

        console.warn('[LEA Storage Refill] Statuslabel konnte nicht geparst werden:', text);
        return true;
    }

    // =========================================================================
    // TRANSPORT-ASSISTENT LOGIK
    // =========================================================================

    /**
     * Führt die Klick-Logik im Transport-Assistenten aus.
     * Phase 1 (Produkte eingetragen): Klickt Fortfahren.
     * Phase 2 (Fahrzeugauswahl): Klickt Frau (auto select) und dann Transport starten.
     */
    async function runStorageAssistantRefill() {
        console.log('[LEA Storage Refill] Starte Assistenten-Durchklick-Logik für Lager...');
        let stepCount = 0;

        while (stepCount < 15) {
            if (stopRequested) return { status: 'stopped' };

            const nextStepBtn = document.querySelector(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR);
            const assistantBtn = document.querySelector(LEA_CONFIG.ASSISTANT_BTN_SELECTOR);

            if (!nextStepBtn) {
                // Button weg -> Transport wahrscheinlich erfolgreich gestartet
                return { status: 'success' };
            }

            const pageText = document.body.textContent || '';
            const isVehicleWindow = pageText.match(/Transportkosten|Ausgewählte Kapazität/);

            if (!isVehicleWindow) {
                // Phase 1: Produktauswahl
                // Wir haben die Mengen per Auto Fill Goods bereits eingetippt, also direkt fortfahren!
                console.log('[LEA Storage Refill] Phase 1: Klicke Fortfahren (Next Step)...');
                simulateClick(nextStepBtn);
                await wait(400);
            } else {
                // Phase 2: Fahrzeugauswahl
                const imgEl = assistantBtn ? assistantBtn.querySelector('img') : null;
                const src = imgEl ? imgEl.getAttribute('src') || '' : '';

                if (src.includes(LEA_CONFIG.IMG_AUTO_SELECT)) {
                    console.log('[LEA Storage Refill] Phase 2: Klicke Frau (Fahrzeuge automatisch wählen)...');
                    simulateClick(assistantBtn);
                    await wait(300);
                } else {
                    // Lieferzeit checken
                    let timeResult = getDeliveryTimeSeconds();
                    let waitTime = 0;
                    while (!timeResult && waitTime < 2000) {
                        await wait(50);
                        waitTime += 50;
                        timeResult = getDeliveryTimeSeconds();
                    }

                    if (!timeResult) {
                        console.log('[LEA Storage Refill] Lieferzeit konnte nicht gelesen werden, starte Transport...');
                    } else if (timeResult.seconds > LEA_CONFIG.settings.maxSupplyDeliveryTimeMinutes * 60) {
                        console.warn(`[LEA Storage Refill] Lieferzeit zu lang (${timeResult.timeString} > ${LEA_CONFIG.settings.maxSupplyDeliveryTimeMinutes} Min). Breche ab!`);
                        showToast(`Zeit zu lang (${timeResult.timeString}). Übersprungen!`);
                        return { status: 'skipped_time' };
                    } else {
                        console.log(`[LEA Storage Refill] Lieferzeit OK (${timeResult.timeString}). Starte Transport...`);
                    }

                    console.log('[LEA Storage Refill] Phase 2: Klicke Transport starten...');
                    simulateClick(nextStepBtn);
                    await waitForElementToDisappear(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR, 3000);
                    return { status: 'success' };
                }
            }

            await wait(300);
            stepCount++;
        }

        return { status: 'failed' };
    }

    // =========================================================================
    // HAUPT-LOOP
    // =========================================================================

    /**
     * Hauptfunktion zur Durchführung des automatischen Lager-Auffüllens.
     */
    async function executeStorageRefill() {
        if (isAutoRunning) return;
        isAutoRunning = true;
        stopRequested = false;
        updateStartButtonState(true);
        showToast('Auto Storage Refill gestartet...');

        const stats = {
            total: 0,
            refilled: 0,
            alreadyFull: 0,
            skippedTime: 0,
            skippedTimeNames: [],
            failed: 0
        };

        const prefix = LEA_CONFIG.settings.storagePrefix || '(LS)';
        const minEmpty = LEA_CONFIG.settings.minEmptyPercentage || 30;

        try {
            // Suche einmalig am Start ausführen
            const searchSuccess = await triggerSearch(prefix);
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

                const next = await waitForNextCard(lastProcessedIndex, prefix);
                if (!next) {
                    console.log(`[LEA Storage Refill] Kein höherer Index als ${lastProcessedIndex} gefunden. Ende der Liste.`);
                    break;
                }

                stats.total++;

                // 1. Vor dem Betreten prüfen, ob befüllt werden muss
                const needsRefill = isStorageEmptyEnough(next.card, minEmpty);
                if (!needsRefill) {
                    stats.alreadyFull++;
                    lastProcessedIndex = next.index;
                    consecutiveFailures = 0;
                    continue;
                }

                // 2. Lager betreten
                const arrowBtn = next.card.querySelector('img[src*="to_quest_objective"]')?.closest('button');
                if (!arrowBtn) {
                    console.warn(`[LEA Storage Refill] Kein Pfeil-Button für Index ${next.index}. Überspringe...`);
                    stats.failed++;
                    lastProcessedIndex = next.index;
                    continue;
                }

                simulateClick(arrowBtn);

                // Warten auf Laden der Lager-Detailseite und Vorhandensein des Fill Up Buttons
                const loaded = await waitForElementToAppear('#lea-auto-fill-btn', 4000);
                if (!loaded) {
                    console.error('[LEA Storage Refill] Detailseite oder "Fill Up"-Button nicht geladen.');
                    await goBack();
                    stats.failed++;
                    consecutiveFailures++;
                    if (consecutiveFailures > 3) {
                        showToast('Fehler: Zu viele Ladefehler. Stoppe.');
                        break;
                    }
                    lastProcessedIndex = next.index;
                    continue;
                }
                await wait(200);

                // Event-Listener für das Auto-Fill-Ergebnis vorbereiten
                let autoFillPromise = new Promise((resolve) => {
                    const handler = (e) => {
                        document.removeEventListener('lea-auto-fill-finished', handler);
                        resolve(e.detail.success);
                    };
                    document.addEventListener('lea-auto-fill-finished', handler);
                    
                    // Fallback-Timeout (15 Sekunden)
                    setTimeout(() => {
                        document.removeEventListener('lea-auto-fill-finished', handler);
                        resolve(false);
                    }, 15000);
                });

                // 3. "Fill Up" Button klicken
                const fillUpBtn = document.getElementById('lea-auto-fill-btn');
                if (fillUpBtn) {
                    console.log('[LEA Storage Refill] Klicke Fill Up...');
                    simulateClick(fillUpBtn);
                    
                    const success = await autoFillPromise;
                    if (success) {
                        console.log('[LEA Storage Refill] Auto Fill Eingaben getätigt. Fahre Assistenten fort...');
                        
                        // 4. Assistenten-Klicklogik ausführen, um den Transport abzuschicken
                        const assistantResult = await runStorageAssistantRefill();
                        
                        if (assistantResult.status === 'success') {
                            stats.refilled++;
                            consecutiveFailures = 0;
                            await wait(600);
                            await goBack();
                            await wait(500);
                        } else {
                            const status = assistantResult.status; // 'skipped_time', 'stopped', oder 'failed'
                            if (status === 'skipped_time') {
                                stats.skippedTime++;
                                const bName = getBuildingName(next.card, prefix);
                                stats.skippedTimeNames.push(bName);
                            } else {
                                stats.failed++;
                            }
                            
                            await navigateBackToBuildingOverview();
                            if (status === 'stopped') break;
                        }
                    } else {
                        console.error('[LEA Storage Refill] Auto Fill Goods hat den Abschluss nicht signalisiert.');
                        stats.failed++;
                        await goBack();
                    }
                } else {
                    console.warn('[LEA Storage Refill] Fill Up Button nicht gefunden.');
                    stats.failed++;
                    await goBack();
                }

                lastProcessedIndex = next.index;
            }

            // Suche am Ende aufheben
            await clearSearch();

            if (stopRequested) {
                showToast('Auto Storage Refill gestoppt.');
            } else {
                showToast('Auto Storage Refill abgeschlossen!');
            }

            if (stats.total > 0) {
                showRefillReportModal(stats);
            }

        } catch (e) {
            console.error('[LEA Storage Refill] Fehler im Hauptablauf:', e);
            showToast('Kritischer Fehler im Ablauf.');
        } finally {
            isAutoRunning = false;
            stopRequested = false;
            updateStartButtonState(false);
        }
    }

    // =========================================================================
    // UI: REPORT / STATISTIK MODAL
    // =========================================================================

    /**
     * Zeigt das Statistik-Modal am Ende des Durchlaufs an.
     */
    function showRefillReportModal(stats) {
        const existing = document.getElementById('lea-storage-report-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'lea-storage-report-modal';
        overlay.className = 'lea-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'lea-modal';

        const title = document.createElement('h3');
        title.className = 'lea-modal-title';
        title.textContent = '🔄 Auto Storage Refill Report';
        modal.appendChild(title);

        const list = document.createElement('div');
        list.className = 'lea-modal-list';

        const items = [
            { label: 'Gesamt geprüfte Lager', value: stats.total, color: '#f7fafc', icon: '🏢' },
            { label: 'Erfolgreich aufgefüllt', value: stats.refilled, color: '#4ade80', icon: '✅' },
            { label: 'Bereits voll / genug Platz', value: stats.alreadyFull, color: '#94a3b8', icon: '⚪' },
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

        if (stats.skippedTimeNames && stats.skippedTimeNames.length > 0) {
            const separator = document.createElement('div');
            separator.style.margin = '12px 0 8px 0';
            separator.style.borderTop = '1px dashed #4b5563';
            list.appendChild(separator);

            const detailsTitle = document.createElement('div');
            detailsTitle.style.fontSize = '0.875rem';
            detailsTitle.style.fontWeight = 'bold';
            detailsTitle.style.color = '#fbbf24';
            detailsTitle.style.marginBottom = '6px';
            detailsTitle.textContent = '⏳ Übersprungene Lager (Zeit zu lang):';
            list.appendChild(detailsTitle);

            stats.skippedTimeNames.forEach(name => {
                const row = document.createElement('div');
                row.className = 'lea-modal-row';
                row.style.paddingLeft = '12px';
                row.style.fontSize = '0.85rem';
                row.style.color = '#d1d5db';
                row.style.justifyContent = 'flex-start';
                
                const bullet = document.createElement('span');
                bullet.textContent = '• ' + name;
                
                row.appendChild(bullet);
                list.appendChild(row);
            });
        }

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
