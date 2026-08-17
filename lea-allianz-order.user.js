// ==UserScript==
// @name         LEA Allianz-Auftrag Assistent
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.0.0
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
        console.log('[LEA Allianz Order] Skript v1.0.0 geladen.');

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
     * Prüft, ob die Allianz-Auftragsseite geöffnet ist, und injiziert den "Allianzorder"-Button.
     */
    function injectButtonIfOnAlliancePage() {
        const bodyText = document.body.textContent || '';
        const isAlliancePage = bodyText.includes('Allianz-Aufträge') || bodyText.includes('Belade Container, um den Allianz-Auftrag zu erfüllen');

        if (!isAlliancePage) {
            const existingBtn = document.getElementById(INJECT_BTN_ID);
            if (existingBtn) existingBtn.remove();
            return;
        }

        if (document.getElementById(INJECT_BTN_ID)) return;

        // Finde den Injektionsort: Sucht nach dem Headerbereich der Allianz-Aufträge oder Stecknadel-Icon
        const pinIcon = document.querySelector('img[src*="pin"], img[src*="location"], img[src*="map_pin"], img[src*="edit"]');
        let headerContainer = null;

        if (pinIcon) {
            headerContainer = pinIcon.closest('div.flex') || pinIcon.parentElement;
        } else {
            // Fallback: Suche Überschrift "Logistikzentrum" oder "Allianz-Aufträge"
            const titleEl = Array.from(document.querySelectorAll('.text-h2, h2, div')).find(el => 
                el.textContent.includes('Logistikzentrum') || el.textContent.includes('Allianz-Aufträge')
            );
            if (titleEl) {
                headerContainer = titleEl.closest('div.flex') || titleEl.parentElement;
            }
        }

        if (!headerContainer) return;

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md theme--light lea-injected-btn';
        if (isAutoRunning) {
            btn.classList.add('lea-btn-running');
        }
        btn.title = 'Allianz-Auftrag Assistent öffnen';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.innerHTML = isAutoRunning ? 'STOP' : 'Allianzorder';
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

        // Vor dem Pin-Icon oder am Ende des Header-Containers einfügen
        if (pinIcon && pinIcon.parentElement) {
            pinIcon.parentElement.parentNode.insertBefore(btn, pinIcon.parentElement);
        } else {
            headerContainer.appendChild(btn);
        }
    }

    // =========================================================================
    // DATEN-EXTRAKTION (PRODUKTE & ZIELE)
    // =========================================================================

    /**
     * Liest die verfügbaren Warenzeilen aus dem Allianz-Auftragsfenster aus.
     * @returns {Array} Liste der ausgelesenen Produkt-Objekte.
     */
    function extractAllianceOrderItems() {
        const items = [];

        // Suche nach allen LKW-Buttons in der Auftragsübersicht
        const buttons = Array.from(document.querySelectorAll('button')).filter(b => {
            const img = b.querySelector('img');
            return img && (img.src.includes('truck') || img.src.includes('transport') || img.src.includes('delivery'));
        });

        buttons.forEach((truckBtn, index) => {
            let rowContainer = truckBtn.closest('div.flex') || truckBtn.parentElement;
            // Gehe im DOM etwas höher, um die gesamte Warenzeile zu erfassen
            for (let depth = 0; depth < 3; depth++) {
                if (rowContainer && rowContainer.parentElement && rowContainer.querySelectorAll('img').length >= 2) {
                    break;
                }
                if (rowContainer && rowContainer.parentElement) {
                    rowContainer = rowContainer.parentElement;
                }
            }

            if (!rowContainer) return;

            // Finde Produkt-Bild (erstes Bild in der Zeile, das kein Container/LKW ist)
            const imgs = Array.from(rowContainer.querySelectorAll('img')).filter(img => {
                const src = img.src.toLowerCase();
                return !src.includes('truck') && !src.includes('container') && !src.includes('transport');
            });

            const productImg = imgs[0] ? imgs[0].src : '';

            // Produktnamen aus Bild-URL ableiten (z. B. "brot.png" -> "Brot")
            let productName = `Produkt ${index + 1}`;
            if (productImg) {
                const fileNameMatch = productImg.match(/\/([^\/]+)\.(png|webp|svg|jpg)/i);
                if (fileNameMatch && fileNameMatch[1]) {
                    const rawName = fileNameMatch[1].replace(/[-_]/g, ' ');
                    productName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
                }
            }

            // Mengen auslesen (z.B. "45/82")
            const rowText = rowContainer.textContent || '';
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
                name: productName,
                imgSrc: productImg,
                current,
                total,
                remaining,
                truckBtn
            });
        });

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
                padding: 12px !important;
                cursor: pointer !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                gap: 6px !important;
                transition: all 0.2s ease !important;
            `;

            card.innerHTML = `
                <img src="${item.imgSrc}" style="width: 44px; height: 44px; object-fit: contain;" alt="${item.name}">
                <div style="font-weight: bold; font-size: 14px; color: #f8fafc;">${item.name}</div>
                <div style="font-size: 12px; color: #cbd5e1;">${item.current} / ${item.total}</div>
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

                // Setze Container-Eingabe automatisch auf das verbleibende Maximum des gewählten Produkts
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

        updateStartButtonState(true);

        showToast(`Starte Senden von ${count} Container(n) für ${targetItem.name}...`, 'lea-toast-start', 2500);

        let sentCount = 0;

        try {
            for (let i = 0; i < count; i++) {
                if (stopRequested) {
                    console.log('[LEA Allianz] Stopp angefordert.');
                    break;
                }

                showToast(`Sende Container ${i + 1} von ${count} (${targetItem.name})...`, 'lea-toast-step', 2000);

                // 1. Erneutes Auslesen der Items, um frischen Button zu holen
                const currentItems = extractAllianceOrderItems();
                const freshItem = currentItems.find(it => it.index === targetItem.index) || currentItems[0];

                if (!freshItem || !freshItem.truckBtn) {
                    console.warn('[LEA Allianz] LKW-Button nicht mehr gefunden!');
                    showToast('⚠️ LKW-Button nicht gefunden. Breche ab.', 'lea-toast-err', 3000);
                    break;
                }

                // Klick auf den LKW-Button in der Zeile
                simulateClick(freshItem.truckBtn);
                await wait(600);

                // 2. Warten auf das Erscheinen des Transportdialogs (Frau-Icon / Assistent)
                const assistantAppeared = await waitForElementToAppear(LEA_CONFIG.ASSISTANT_BTN_SELECTOR, 4000, () => stopRequested);

                if (!assistantAppeared) {
                    console.warn('[LEA Allianz] Transportdialog ist nicht erschienen.');
                    showToast('⚠️ Transportfenster konnte nicht geöffnet werden.', 'lea-toast-err', 3000);
                    break;
                }

                // 3. Klick auf den Transport-Assistenten (Frau-Icon / Autoselect)
                const assistantBtn = document.querySelector(LEA_CONFIG.ASSISTANT_BTN_SELECTOR);
                if (assistantBtn) {
                    simulateClick(assistantBtn);
                    await wait(800);
                }

                // 4. Lieferzeit prüfen
                const deliveryInfo = getDeliveryTimeSeconds();
                const maxAllowedMinutes = LEA_CONFIG.settings.maxOrderDeliveryTimeMinutes || 15;

                if (deliveryInfo && deliveryInfo.seconds > maxAllowedMinutes * 60) {
                    console.warn(`[LEA Allianz] Lieferzeit zu hoch: ${deliveryInfo.timeString} (Limit: ${maxAllowedMinutes}m)`);
                    showToast(`⚠️ Abgebrochen: Lieferzeit zu hoch (${deliveryInfo.timeString})`, 'lea-toast-warn', 3500);
                    await goBack();
                    break;
                }

                // 5. Klick auf "Weiter" / "Starten"
                const nextStepBtn = document.querySelector(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR);

                if (!nextStepBtn || nextStepBtn.disabled) {
                    console.warn('[LEA Allianz] Weiter-Button ist nicht klickbar oder keine LKWs verfügbar.');
                    showToast('⚠️ Keine Fahrzeuge verfügbar oder Button gesperrt.', 'lea-toast-warn', 3000);
                    await goBack();
                    break;
                }

                simulateClick(nextStepBtn);
                await wait(1000);

                // Warten bis der Transportdialog verschwunden ist
                await waitForElementToDisappear(LEA_CONFIG.NEXT_STEP_BTN_SELECTOR, 3500, () => stopRequested);
                await wait(600);

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
                inner.innerHTML = running ? 'STOP' : 'Allianzorder';
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
