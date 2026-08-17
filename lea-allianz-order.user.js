// ==UserScript==
// @name         LEA Allianz-Auftrag Assistent
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.0.4
// @match        https://game.logistics-empire.com/*
// @description  Automatisches Versenden von Containern für Allianz-Aufträge.
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-allianz-order.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-allianz-order.user.js
// ==UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & CONSTANTS
    // =========================================================================
    const INJECT_BTN_ID = 'lea-allianz-order-btn';
    const FLOATING_STOP_BTN_ID = 'lea-allianz-stop-btn';
    const MODAL_ID = 'lea-allianz-modal';

    let isAutoRunning = false;
    let stopRequested = false;
    let observer = null;
    let isHandlingMutations = false;

    // =========================================================================
    // INIT & OBSERVER
    // =========================================================================
    function init() {
        console.log('[LEA Allianz Order] Skript v1.0.4 geladen.');

        observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    handleDomMutations();
                    isHandlingMutations = false;
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        handleDomMutations();
    }

    function handleDomMutations() {
        injectButtonIfOnAlliancePage();
    }

    // =========================================================================
    // DOM-DETEKTION & BUTTON INJEKTION
    // =========================================================================

    /**
     * Prüft, ob die Allianz-Auftragsseite geöffnet ist, und injiziert den "Allianz-\nOrder"-Button in die Header-Leiste.
     */
    function injectButtonIfOnAlliancePage() {
        const bodyText = document.body.textContent || '';
        const isAlliancePage = location.hash.includes('alliances') ||
                               bodyText.includes('Allianz-Aufträge') ||
                               bodyText.includes('Gelieferte Container') ||
                               bodyText.includes('Belade Container');

        if (!isAlliancePage) {
            const existingBtn = document.getElementById(INJECT_BTN_ID);
            if (existingBtn) existingBtn.remove();
            return;
        }

        if (document.getElementById(INJECT_BTN_ID)) return;

        // Finde den Injektionsort: Header-Button-Container (.flex.gap-2) neben Map/Manage Buttons
        const headerIcon = document.querySelector('img[data-key*="tobuildingonmap"], img[src*="tobuildingonmap"], img[data-key*="manage"], img[src*="manage"], img[data-key*="sub_order"]');
        let btnContainer = null;

        if (headerIcon) {
            btnContainer = headerIcon.closest('.flex.gap-2') || headerIcon.closest('.justify-self-end') || headerIcon.parentElement;
        }

        if (!btnContainer) {
            const panelHeader = document.querySelector('.panel-header .justify-self-end, .panel-header');
            if (panelHeader) {
                btnContainer = panelHeader.querySelector('.flex.gap-2') || panelHeader;
            }
        }

        if (!btnContainer) return;

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md shape--square theme--light lea-injected-btn my-1 size-12';
        if (isAutoRunning) {
            btn.classList.add('lea-btn-running');
        }
        btn.title = 'Allianz-Auftrag Assistent öffnen';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.style.cssText = 'font-size: 10px; line-height: 1.1; font-weight: bold; text-align: center; white-space: pre-line; padding: 2px;';
        inner.textContent = isAutoRunning ? 'STOP' : 'Allianz-\nOrder';
        btn.appendChild(inner);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isAutoRunning) {
                stopRequested = true;
                showToast('Stoppe Allianz-Auftrag...', 'lea-toast-warn', 2000);
            } else {
                openAllianceOrderModal();
            }
        });

        // Als erstes Element im Button-Container einfügen
        btnContainer.insertBefore(btn, btnContainer.firstChild);
        console.log('[LEA Allianz Order] Quadratischer Button "Allianz-Order" im Header injiziert!');
    }

    // =========================================================================
    // DATEN-EXTRAKTION (PRODUKTE & ZIELE)
    // =========================================================================

    /**
     * Liest die verfügbaren Warenzeilen (.lao-container) aus dem Allianz-Auftragsfenster aus.
     * @returns {Array} Liste der ausgelesenen Produkt-Objekte.
     */
    function extractAllianceOrderItems() {
        const items = [];

        // Suche alle Allianz-Auftrags-Container (.lao-container)
        const containers = Array.from(document.querySelectorAll('.lao-container, [class*="lao-container"]'));

        containers.forEach((container, index) => {
            // 1. Finde den Start-Button (enthält img mit start_order)
            const truckBtn = container.querySelector('button') || 
                             Array.from(container.querySelectorAll('button')).find(b => {
                                 const img = b.querySelector('img');
                                 const key = img ? (img.getAttribute('data-key') || img.src || '') : '';
                                 return key.includes('start_order') || key.includes('truck');
                             });

            if (!truckBtn) return;

            // 2. Finde das Produkt-Bild (data-key startet mit regular/res_ oder src enthält res_)
            const productImgEl = container.querySelector('img[data-key*="res_"], img[src*="res_"]') ||
                                Array.from(container.querySelectorAll('img')).find(img => {
                                    const key = (img.getAttribute('data-key') || img.src || '').toLowerCase();
                                    return !key.includes('sub_order') && !key.includes('start_order') && !key.includes('container');
                                });

            const productImgSrc = productImgEl ? productImgEl.src : '';

            // 3. Mengen auslesen (z.B. "45/82")
            const rowText = container.textContent || '';
            const ratioMatch = rowText.match(/(\d+)\s*\/\s*(\d+)/);

            let current = 0;
            let total = 0;

            if (ratioMatch) {
                current = parseInt(ratioMatch[1], 10);
                total = parseInt(ratioMatch[2], 10);
            }

            const remaining = Math.max(0, total - current);

            items.push({
                index,
                imgSrc: productImgSrc,
                current,
                total,
                remaining,
                truckBtn
            });
        });

        console.log('[LEA Allianz Order] Ausgelesene Aufträge:', items);
        return items;
    }

    // =========================================================================
    // MODAL-DIALOG (PRODUKTAUSWAHL & CONTAINER-EINGABE)
    // =========================================================================

    function openAllianceOrderModal() {
        const existingModal = document.getElementById(MODAL_ID);
        if (existingModal) existingModal.remove();

        const items = extractAllianceOrderItems();

        if (items.length === 0) {
            showToast('⚠️ Keine Allianz-Aufträge im Fenster gefunden!', 'lea-toast-err', 3000);
            return;
        }

        let selectedIndex = 0;

        // Modal Overlay Container
        const backdrop = document.createElement('div');
        backdrop.id = MODAL_ID;
        backdrop.style.cssText = `
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            background: rgba(0, 0, 0, 0.75) !important;
            backdrop-filter: blur(4px) !important;
            z-index: 99999 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            font-family: inherit !important;
        `;

        // Modal Content Card
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: #1e293b !important;
            border: 2px solid #38bdf8 !important;
            border-radius: 16px !important;
            padding: 24px !important;
            width: 440px !important;
            max-width: 90vw !important;
            color: #f8fafc !important;
            box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.5) !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 16px !important;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            border-bottom: 1px solid #334155 !important;
            padding-bottom: 12px !important;
        `;
        header.innerHTML = `
            <div style="font-size: 18px; font-weight: bold; color: #f59e0b; display: flex; align-items: center; gap: 8px;">
                <span>🚛</span> Allianz-Auftrag Assistent
            </div>
            <button id="lea-modal-close" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer;">✕</button>
        `;

        // Body / Product Selection
        const body = document.createElement('div');
        body.style.cssText = 'display: flex; flex-direction: column; gap: 12px;';

        const subTitle = document.createElement('div');
        subTitle.style.cssText = 'font-size: 13px; color: #94a3b8; font-weight: 600;';
        subTitle.textContent = '1. Wähle das zu liefernde Produkt:';
        body.appendChild(subTitle);

        const cardsContainer = document.createElement('div');
        cardsContainer.style.cssText = 'display: flex; gap: 10px;';

        items.forEach((item, idx) => {
            const card = document.createElement('div');
            card.dataset.index = idx;
            const isSelected = idx === 0;

            card.style.cssText = `
                flex: 1 !important;
                background: ${isSelected ? '#0f172a' : '#334155'} !important;
                border: 2px solid ${isSelected ? '#f59e0b' : 'transparent'} !important;
                border-radius: 12px !important;
                padding: 16px 12px !important;
                cursor: pointer !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 8px !important;
                transition: all 0.2s ease !important;
            `;

            card.innerHTML = `
                <img src="${item.imgSrc}" style="width: 64px; height: 64px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));" alt="Produkt Icon">
                <div style="font-weight: bold; font-size: 14px; color: #cbd5e1;">${item.current} / ${item.total}</div>
                <div style="font-size: 11px; color: #38bdf8; font-weight: 600;">noch ${item.remaining} frei</div>
            `;

            card.addEventListener('click', () => {
                selectedIndex = idx;
                Array.from(cardsContainer.children).forEach(c => {
                    const cIdx = parseInt(c.dataset.index, 10);
                    const active = cIdx === selectedIndex;
                    c.style.background = active ? '#0f172a' : '#334155';
                    c.style.borderColor = active ? '#f59e0b' : 'transparent';
                });

                const inputEl = modal.querySelector('#lea-container-input');
                if (inputEl) {
                    inputEl.value = items[selectedIndex].remaining || 1;
                }
            });

            cardsContainer.appendChild(card);
        });

        body.appendChild(cardsContainer);

        // Section 2: Container input
        const inputSection = document.createElement('div');
        inputSection.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-top: 6px;';
        inputSection.innerHTML = `
            <div style="font-size: 13px; color: #94a3b8; font-weight: 600;">2. Wie viele Container möchtest du senden?</div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <input id="lea-container-input" type="number" min="1" max="${items[0].remaining || 999}" value="${items[0].remaining || 1}" 
                       style="flex: 1; background: #0f172a; border: 1px solid #475569; border-radius: 8px; padding: 10px; color: #fff; font-size: 16px; font-weight: bold; text-align: center;">
                <button type="button" class="lea-preset-btn" data-val="1" style="background: #334155; border: 1px solid #475569; border-radius: 8px; padding: 10px 14px; color: #fff; font-size: 13px; cursor: pointer; font-weight: 600;">1</button>
                <button type="button" class="lea-preset-btn" data-val="5" style="background: #334155; border: 1px solid #475569; border-radius: 8px; padding: 10px 14px; color: #fff; font-size: 13px; cursor: pointer; font-weight: 600;">5</button>
                <button type="button" class="lea-preset-btn" data-val="10" style="background: #334155; border: 1px solid #475569; border-radius: 8px; padding: 10px 14px; color: #fff; font-size: 13px; cursor: pointer; font-weight: 600;">10</button>
                <button type="button" id="lea-preset-max" style="background: #f59e0b; border: none; border-radius: 8px; padding: 10px 14px; color: #000; font-size: 13px; cursor: pointer; font-weight: bold;">MAX</button>
            </div>
        `;

        body.appendChild(inputSection);

        // Actions
        const footer = document.createElement('div');
        footer.style.cssText = 'display: flex; gap: 10px; margin-top: 8px;';
        footer.innerHTML = `
            <button id="lea-start-order-btn" style="flex: 2; background: #22c55e; color: #fff; border: none; border-radius: 10px; padding: 12px; font-size: 15px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
                <span>🚀</span> Auftrag Starten
            </button>
            <button id="lea-cancel-order-btn" style="flex: 1; background: #475569; color: #fff; border: none; border-radius: 10px; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer;">
                Abbrechen
            </button>
        `;

        modal.appendChild(header);
        modal.appendChild(body);
        modal.appendChild(footer);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Event-Listener für Eingabe-Buttons
        const inputEl = modal.querySelector('#lea-container-input');

        modal.querySelectorAll('.lea-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                inputEl.value = btn.dataset.val;
            });
        });

        modal.querySelector('#lea-preset-max').addEventListener('click', () => {
            inputEl.value = items[selectedIndex].remaining || 1;
        });

        const closeModal = () => backdrop.remove();
        modal.querySelector('#lea-modal-close').addEventListener('click', closeModal);
        modal.querySelector('#lea-cancel-order-btn').addEventListener('click', closeModal);

        // Start Button Event
        modal.querySelector('#lea-start-order-btn').addEventListener('click', () => {
            const count = parseInt(inputEl.value, 10);
            if (isNaN(count) || count <= 0) {
                showToast('⚠️ Bitte eine gültige Anzahl eingeben!', 'lea-toast-err', 2000);
                return;
            }

            const chosenItem = items[selectedIndex];
            closeModal();
            startAllianceOrderLoop(chosenItem, count);
        });
    }

    // =========================================================================
    // AUTOMATISIERS-SCHLEIFE (LOOP EXECUTER)
    // =========================================================================

    /**
     * Führt das Versenden der gewünschten Anzahl an Containern aus.
     */
    async function startAllianceOrderLoop(targetItem, count) {
        isAutoRunning = true;
        stopRequested = false;

        // Signalisiere allen LEA-Skripten (z.B. Safety Lock), dass eine Automatisierung läuft
        if (window.LEA_CONFIG) {
            window.LEA_CONFIG.isAutomationRunning = true;
        }

        updateStartButtonState(true);
        showToast(`Starte Senden von ${count} Container(n)...`, 'lea-toast-start', 2500);

        let sentCount = 0;

        try {
            for (let i = 0; i < count; i++) {
                if (stopRequested) {
                    console.log('[LEA Allianz] Stopp angefordert.');
                    break;
                }

                showToast(`Sende Container ${i + 1} von ${count}...`, 'lea-toast-step', 2000);

                // 1. Warten, bis die Auftragszeilen im DOM gerendert sind (z. B. nach Rückkehr vom Transportdialog)
                await waitForElementToAppear('.lao-container, [class*="lao-container"]', 4000, () => stopRequested);

                // Versuche bis zu 5-mal mit 300ms Abstand, die Items auszulesen (falls Vue.js kurz zum Rendern braucht)
                let currentItems = extractAllianceOrderItems();
                let retryCount = 0;
                while (currentItems.length === 0 && retryCount < 5) {
                    if (stopRequested) break;
                    await wait(300);
                    retryCount++;
                    currentItems = extractAllianceOrderItems();
                }

                const freshItem = currentItems.find(it => it.index === targetItem.index) || currentItems[0];

                if (!freshItem || !freshItem.truckBtn) {
                    console.warn('[LEA Allianz] LKW-Button nicht mehr gefunden!');
                    showToast('⚠️ LKW-Button nicht gefunden. Breche ab.', 'lea-toast-err', 3000);
                    break;
                }

                // Klick auf den LKW-Button in der Zeile (öffnet Phase 1: Produktauswahl)
                simulateClick(freshItem.truckBtn);
                await wait(600);

                // 2. Warten auf das Erscheinen des Assistent-Buttons
                const assistantAppeared = await waitForElementToAppear(LEA_CONFIG.ASSISTANT_BTN_SELECTOR, 4000, () => stopRequested);

                if (!assistantAppeared) {
                    console.warn('[LEA Allianz] Transportdialog ist nicht erschienen.');
                    showToast('⚠️ Transportfenster konnte nicht geöffnet werden.', 'lea-toast-err', 3000);
                    break;
                }

                // --- PHASE 1: PRODUKTAUSWAHL (Waren wählen) ---
                const assistantBtnPhase1 = document.querySelector(LEA_CONFIG.ASSISTANT_BTN_SELECTOR);
                if (assistantBtnPhase1) {
                    console.log('[LEA Allianz] Phase 1: Klicke Assistent (Waren automatisch wählen)...');
                    simulateClick(assistantBtnPhase1);
                    await wait(500);
                }

                // Dynamisch warten, bis der "Weiter"-Button aktiv/klickbar ist
                let nextStepBtnPhase1 = document.querySelector(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR);
                let waitP1Counter = 0;
                while (waitP1Counter < 30 && (!nextStepBtnPhase1 || nextStepBtnPhase1.disabled || nextStepBtnPhase1.classList.contains('lea-btn-disabled'))) {
                    if (stopRequested) break;
                    await wait(100);
                    waitP1Counter++;
                    nextStepBtnPhase1 = document.querySelector(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR);
                }

                if (nextStepBtnPhase1 && !nextStepBtnPhase1.disabled) {
                    console.log('[LEA Allianz] Phase 1: Klicke Weiter (zur Fahrzeugauswahl)...');
                    simulateClick(nextStepBtnPhase1);
                    await wait(800);
                }

                // --- PHASE 2: FAHRZEUGAUSWAHL (LKWs wählen) ---
                // Warten bis der Assistenten-Button in Phase 2 klickbar ist
                await waitForElementToAppear(LEA_CONFIG.ASSISTANT_BTN_SELECTOR, 4000, () => stopRequested);

                const assistantBtnPhase2 = document.querySelector(LEA_CONFIG.ASSISTANT_BTN_SELECTOR);
                if (assistantBtnPhase2) {
                    console.log('[LEA Allianz] Phase 2: Klicke Assistent (Fahrzeuge automatisch wählen)...');
                    simulateClick(assistantBtnPhase2);
                    await wait(500);
                }

                // Dynamisch warten, bis der "Starten"-Button aktiviert wird (Safety Lock entsperrt)
                let finalStartBtn = document.querySelector(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR);
                let waitP2Counter = 0;
                while (waitP2Counter < 35 && (!finalStartBtn || finalStartBtn.disabled || finalStartBtn.classList.contains('lea-btn-disabled'))) {
                    if (stopRequested) break;
                    await wait(100);
                    waitP2Counter++;
                    finalStartBtn = document.querySelector(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR);
                }

                // Lieferzeit prüfen
                const deliveryInfo = getDeliveryTimeSeconds();
                const maxAllowedMinutes = LEA_CONFIG.settings.maxOrderDeliveryTimeMinutes || 15;

                if (deliveryInfo && deliveryInfo.seconds > maxAllowedMinutes * 60) {
                    console.warn(`[LEA Allianz] Lieferzeit zu hoch: ${deliveryInfo.timeString} (Limit: ${maxAllowedMinutes}m)`);
                    showToast(`⚠️ Abgebrochen: Lieferzeit zu hoch (${deliveryInfo.timeString})`, 'lea-toast-warn', 3500);
                    await goBack();
                    break;
                }

                if (!finalStartBtn || finalStartBtn.disabled || finalStartBtn.classList.contains('lea-btn-disabled')) {
                    console.warn('[LEA Allianz] Starten-Button ist nicht klickbar oder keine LKWs verfügbar.');
                    showToast('⚠️ Keine Fahrzeuge verfügbar oder Button gesperrt.', 'lea-toast-warn', 3000);
                    await goBack();
                    break;
                }

                console.log('[LEA Allianz] Phase 2: Klicke Starten...');
                simulateClick(finalStartBtn);
                await wait(1000);

                // Warten bis der Transportdialog verschwunden ist
                await waitForElementToDisappear(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR, 3500, () => stopRequested);
                await wait(800);

                sentCount++;
            }

            if (sentCount > 0 && !stopRequested) {
                showToast(`✅ ${sentCount} Container erfolgreich versendet!`, 'lea-toast-success', 3500);
            }
        } catch (err) {
            if (err.message === 'STOP') {
                console.log('[LEA Allianz] Prozess durch Benutzer gestoppt.');
            } else {
                console.error('[LEA Allianz] Fehler beim Ausführen:', err);
                showToast('⚠️ Fehler beim Ausführen: ' + err.message, 'lea-toast-err', 3000);
            }
        } finally {
            isAutoRunning = false;
            if (window.LEA_CONFIG) {
                window.LEA_CONFIG.isAutomationRunning = false;
            }
            updateStartButtonState(false);
        }
    }

    // =========================================================================
    // UI HELPER & FLOATING STOP BUTTON
    // =========================================================================

    function updateStartButtonState(running) {
        const btn = document.getElementById(INJECT_BTN_ID);
        if (btn) {
            const inner = btn.querySelector('div');
            if (inner) {
                inner.textContent = running ? 'STOP' : 'Allianz-\nOrder';
            }
            if (running) {
                btn.classList.add('lea-btn-running');
            } else {
                btn.classList.remove('lea-btn-running');
            }
        }
        updateFloatingStopButton(running);
    }

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
            btn.textContent = '🛑 STOP Allianz-Auftrag';

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[LEA Allianz] Stop angefordert über Floating Button!');
                showToast('Ablauf wird gestoppt...', 'lea-toast-warn', 2000);
                stopRequested = true;
                btn.textContent = 'Stoppt...';
                btn.classList.add('lea-btn-disabled');
            });

            document.body.appendChild(btn);
        }
    }

    // =========================================================================
    // STARTUP
    // =========================================================================
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
