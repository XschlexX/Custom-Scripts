// ==UserScript==
// @name         LEA Auto Produktion Change
// @namespace    le-tools
// @version      1.0.17
// @match        https://game.logistics-empire.com/*
// @description  Aendert die Produktion in den Produktionslinien per Knopfdruck.
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-produktion-change.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-produktion-change.user.js
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // SELEKTOREN & KONSTANTEN
    // -----------------------------------------------------------------------
    const INJECT_BTN_ID = 'lea-prod-change-btn';
    const MENU_ID = 'lea-prod-change-menu';

    // Selektoren - Gebäudeübersicht
    const SELECTOR_MANAGE_BTN = 'button[data-tutorial-id="manage-building-button"]';
    const SELECTOR_SETTINGS_BTN = 'button[data-tutorial-id="factory-line-settings-button"]';
    const SELECTOR_UNLOCK_BTN = '[data-tutorial-id="factory-line-unlock"]';
    const SELECTOR_PANEL_HEADER = '.panel-header p';

    // Selektoren - Linieneinstellungen
    const SELECTOR_STOP_BTN = '[data-tutorial-id="factory-line-configuration-stop-button"]';
    const SELECTOR_RESOURCE_BTN = '[data-tutorial-id="factory-line-configuration-resource-button"]';
    const SELECTOR_SAVE_BTN = 'button[data-tutorial-id="factory-line-save-changes"]';
    const SELECTOR_BACK_BTN = '.bottom-navigation button[show-divider]';
    const SELECTOR_DIALOG = '.bb-dialog-modal';

    // Cache für Gebäude-Produkte (Name -> { products: [...], stopImgSrc: ... })
    const productCache = {};

    // -----------------------------------------------------------------------
    // SCHRITT 1: UI-Injektion (Button & Menü)
    // -----------------------------------------------------------------------

    /**
     * Fügt den "Prod. ändern"-Button in die Titel-Leiste von Produktionsgebäuden ein.
     * Prüft zuvor, ob es sich wirklich um ein Produktionsgebäude handelt (kein Lager).
     */
    function injectProductionChangeButton() {
        const editBtn = document.querySelector(SELECTOR_MANAGE_BTN);

        if (!editBtn) return; // Wenn der gelbe Button nicht gefunden wurde, abbrechen

        // Prüfen, ob es überhaupt ein Produktionsgebäude ist.
        // Ein Produktionsgebäude hat entweder Einstellungs-Buttons für Linien, freischaltbare Linien 
        // oder die Überschrift "Produktionslinien".
        const isProductionBuilding =
            document.querySelector(SELECTOR_SETTINGS_BTN) ||
            document.querySelector(SELECTOR_UNLOCK_BTN) ||
            Array.from(document.querySelectorAll(SELECTOR_PANEL_HEADER)).some(p => p.textContent.includes('Produktionslinien'));

        if (!isProductionBuilding) {
            // Wenn der Button hier existiert (z.B. nach Tab-Wechsel in einem Lager), entfernen wir ihn zur Sicherheit
            const existingBtn = document.getElementById(INJECT_BTN_ID);
            if (existingBtn) existingBtn.remove();
            return;
        }

        if (document.getElementById(INJECT_BTN_ID)) return; // Button ist schon da

        const headerContainer = editBtn.parentNode;

        // Button erstellen (im gleichen Stil wie andere LEA Buttons)
        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md shape--square theme--light lea-injected-btn';
        btn.title = 'Produktion ändern';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.textContent = 'Change\nProduct';
        btn.appendChild(inner);

        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            let currentBtn = btn;
            const key = getBuildingKey(btn);
            if (!productCache[key]) {
                const success = await scanBuildingProducts(btn);
                if (!success) {
                    console.warn('[LEA Auto Prod Change] Scan nicht erfolgreich/möglich. Zeige Standard-Optionen.');
                }
                // Kurz warten, bis das Hauptfenster wieder voll sichtbar und ausgerichtet ist
                await new Promise(r => setTimeout(r, 400));
                // WICHTIG: Nach dem Scan hat Vue die Ansicht komplett neu aufgebaut.
                // Der ursprüngliche `btn` ist nun verwaist und hat Koordinaten 0,0!
                // Wir müssen den neuen Button aus dem aktiven DOM holen:
                currentBtn = document.getElementById(INJECT_BTN_ID) || btn;
            }
            showProductionSelectionMenu(currentBtn);
        });

        // Button vor dem Edit-Button einfügen
        headerContainer.insertBefore(btn, editBtn);
        console.log('[LEA Auto Prod Change] Button eingefügt.');
    }

    /**
     * Ermittelt den Titel des aktuellen Gebäudes aus der UI.
     * @returns {string} Gebäudename oder Fallback
     */
    /**
     * Ermittelt den eindeutigen Cache-Schlüssel für das Gebäude.
     * Nutzt bevorzugt den Dateinamen des Gebäude-Icons (z.B. mega_mill, mega_potato_farm).
     * @param {HTMLElement} btn - Referenz-Button
     * @returns {string} Cache-Schlüssel
     */
    function getBuildingKey(btn) {
        const referenceBtn = btn || document.querySelector(SELECTOR_MANAGE_BTN);
        if (!referenceBtn) return 'default-building';

        const header = referenceBtn.closest('.flex.flex-nowrap') || referenceBtn.closest('.panel-header') || referenceBtn.parentElement?.parentElement;
        if (!header) return 'default-building';

        // Versuche Gebäude-Typ aus dem Avatar-Icon zu parsen (z.B. icon_bld_mega_potato_farm-Cl9bi6ul.avif -> mega_potato_farm)
        const avatarImg = header.querySelector('img[src*="icon_bld_"]');
        if (avatarImg) {
            const src = avatarImg.getAttribute('src') || avatarImg.src || '';
            const match = src.match(/\/icon_bld_([^/-]+)/);
            if (match && match[1]) {
                return match[1];
            }
        }

        // Fallback: Name des Gebäudes (.text-h1)
        const titleEl = header.querySelector('.text-h1');
        if (titleEl) {
            return titleEl.textContent.trim();
        }

        return 'default-building';
    }

    /**
     * Ermittelt den Titel des aktuellen Gebäudes aus der UI.
     * @param {HTMLElement} btn - Referenz-Button
     * @returns {string} Gebäudename oder Fallback
     */
    function getBuildingTitle(btn) {
        const referenceBtn = btn || document.querySelector(SELECTOR_MANAGE_BTN);
        if (!referenceBtn) return 'default-building';

        const header = referenceBtn.closest('.flex.flex-nowrap') || referenceBtn.closest('.panel-header') || referenceBtn.parentElement?.parentElement;
        if (!header) return 'default-building';

        const titleEl = header.querySelector('.text-h1');
        if (titleEl) {
            return titleEl.textContent.trim();
        }
        return 'default-building';
    }



    /**
     * Öffnet kurz das Einstellungsmenü, liest die verfügbaren Produkte aus und schließt es wieder.
     * @param {HTMLElement} anchorBtn - Der Change-Product Button
     * @returns {Promise<boolean>}
     */
    async function scanBuildingProducts(anchorBtn) {
        const buildingTitle = getBuildingTitle(anchorBtn);
        const key = getBuildingKey(anchorBtn);
        console.log(`[LEA Auto Prod Change] Starte Scan für Gebäude: ${buildingTitle} (Key: ${key})`);

        const settingsBtn = document.querySelector(SELECTOR_SETTINGS_BTN);
        if (!settingsBtn) return false;

        const inner = anchorBtn.querySelector('.lea-injected-btn-inner');
        const originalText = inner.textContent;
        inner.textContent = 'Scanne...';
        anchorBtn.disabled = true;

        try {
            settingsBtn.click();

            const opened = await waitForElementToAppear(SELECTOR_RESOURCE_BTN, 2000);
            if (!opened) throw new Error('Einstellungsmenü nicht geladen.');

            // Längere Wartezeit, damit alle Vue-Kacheln gerendert werden können
            await new Promise(r => setTimeout(r, 500));

            const resBtns = document.querySelectorAll(SELECTOR_RESOURCE_BTN);
            const products = [];

            resBtns.forEach((btn, index) => {
                const img = btn.querySelector('img');
                if (img) {
                    const src = img.getAttribute('src') || img.src || '';
                    products.push({
                        action: `prod${index + 1}`,
                        imgSrc: src
                    });
                }
            });

            const stopBtn = document.querySelector(SELECTOR_STOP_BTN);
            let stopImgSrc = null;
            if (stopBtn) {
                const img = stopBtn.querySelector('img');
                if (img) stopImgSrc = img.getAttribute('src') || img.src || '';
            }

            const backBtn = document.querySelector(SELECTOR_BACK_BTN);
            if (backBtn) {
                backBtn.click();
                await waitForElementToDisappear(SELECTOR_SAVE_BTN, 2000);
            }

            if (products.length > 0) {
                productCache[key] = {
                    products: products,
                    stopImgSrc: stopImgSrc
                };
                return true;
            }
            return false;
        } catch (err) {
            console.error('[LEA Auto Prod Change] Fehler beim Scannen:', err);
            const backBtn = document.querySelector(SELECTOR_BACK_BTN);
            if (backBtn && document.querySelector(SELECTOR_SAVE_BTN)) {
                backBtn.click();
            }
            return false;
        } finally {
            inner.textContent = originalText;
            anchorBtn.disabled = false;
        }
    }

    function renderMixSubMenu(menu, anchorBtn, products) {
        menu.innerHTML = '';
        menu.className = 'lea-prod-menu theme--light variant--neutral lea-prod-menu-col';

        const topRow = document.createElement('div');
        topRow.className = 'lea-prod-row lea-prod-row-start';

        const backBtn = document.createElement('div');
        backBtn.className = 'bb-base-tile cursor-pointer lea-prod-menu-btn theme--light variant--neutral lea-tile-32';
        backBtn.setAttribute('data-v-d2de3745', '');
        backBtn.innerHTML = `
            <div data-v-25a4a5a3="" class="bb-beveled-tile drop-shadow-(--outer-shadow) **:h-full tile--normal bb-base-tile__background">
                <div data-v-25a4a5a3="" class="tile__border border border-(--border-color) bg-(--border-color)" style="clip-path: polygon(10px 0px, calc(100% - 10px) 0px, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0px calc(100% - 10px), 0px 10px);">
                    <div data-v-25a4a5a3="" style="--shadow-in-color: #291F02;">
                        <div data-v-25a4a5a3="" class="tile__background flex items-center justify-center [background:var(--bg-gradient)]" style="clip-path: polygon(9.6px 0px, calc(100% - 9.6px) 0px, 100% 9.6px, 100% calc(100% - 9.6px), calc(100% - 9.6px) 100%, 9.6px 100%, 0px calc(100% - 9.6px), 0px 9.6px);"></div>
                    </div>
                </div>
            </div>
            <div class="bb-base-tile__content p-0.75" style="position: absolute; inset: 0; z-index: 1;">
                <div class="relative size-full min-h-0 overflow-hidden flex items-center justify-center" style="font-size: 16px;">
                    🔙
                </div>
            </div>
        `;
        backBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.remove();
            showProductionSelectionMenu(anchorBtn);
        });
        topRow.appendChild(backBtn);
        menu.appendChild(topRow);

        const combosRow = document.createElement('div');
        combosRow.className = 'lea-prod-row lea-prod-row-col';

        let combinations = [];
        if (products.length === 2) {
            combinations = [
                [products[0], products[0], products[1]], // A A B
                [products[0], products[1], products[1]]  // A B B
            ];
        } else if (products.length >= 3) {
            combinations = [
                [products[0], products[1], products[2]]  // A B C
            ];
        }

        combinations.forEach(combo => {
            const comboBtn = document.createElement('div');
        comboBtn.className = 'bb-base-tile cursor-pointer lea-prod-menu-btn theme--light variant--neutral lea-tile-100x40';
            comboBtn.setAttribute('data-v-d2de3745', '');

            let imgsHtml = combo.map(p => `<img src="${p.imgSrc}" draggable="false" style="width: 24px; height: 24px; object-fit: contain;">`).join('');

            comboBtn.innerHTML = `
                <div data-v-25a4a5a3="" class="bb-beveled-tile drop-shadow-(--outer-shadow) **:h-full tile--normal bb-base-tile__background">
                    <div data-v-25a4a5a3="" class="tile__border border border-(--border-color) bg-(--border-color)" style="clip-path: polygon(10px 0px, calc(100% - 10px) 0px, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0px calc(100% - 10px), 0px 10px);">
                        <div data-v-25a4a5a3="" style="--shadow-in-color: #291F02;">
                            <div data-v-25a4a5a3="" class="tile__background flex items-center justify-center [background:var(--bg-gradient)]" style="clip-path: polygon(9.6px 0px, calc(100% - 9.6px) 0px, 100% 9.6px, 100% calc(100% - 9.6px), calc(100% - 9.6px) 100%, 9.6px 100%, 0px calc(100% - 9.6px), 0px 9.6px);"></div>
                        </div>
                    </div>
                </div>
                <div class="bb-base-tile__content p-0.75" style="position: absolute; inset: 0; z-index: 1;">
                    <div class="relative size-full min-h-0 overflow-hidden flex items-center justify-center" style="gap: 4px;">
                        ${imgsHtml}
                    </div>
                </div>
            `;

            comboBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.remove();
                executeProductionChange(combo.map(p => p.action));
            });
            combosRow.appendChild(comboBtn);
        });

        menu.appendChild(combosRow);

        const rect = anchorBtn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        menu.style.left = `${rect.right + window.scrollX - menuRect.width}px`;
    }

    /**
     * Zeigt das Dropdown-Menü zur Auswahl der Aktion (Stop, Produkte mit Bildern, Mix).
     * @param {HTMLElement} anchorBtn - Der Button, unter dem das Menü auftauchen soll.
     */
    function showProductionSelectionMenu(anchorBtn) {
        const existing = document.getElementById(MENU_ID);
        if (existing) {
            existing.remove();
            return;
        }

        const menu = document.createElement('div');
        menu.id = MENU_ID;
        // Füge native Theme- und Varianten-Klassen hinzu, damit CSS-Variablen wie --bg-gradient greifen
        menu.className = 'lea-prod-menu theme--light variant--neutral';

        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY + 10}px`;
        // Sichtbarkeit vorübergehend ausblenden, um die Breite zu berechnen
        menu.style.visibility = 'hidden';

        const key = getBuildingKey(anchorBtn);
        const cached = productCache[key];

        let options = [];
        if (cached && cached.products && cached.products.length > 0) {
            options.push({
                action: 'stop',
                imgSrc: cached.stopImgSrc
            });
            options.push(...cached.products);
            options.push({
                action: 'mix'
            });
        } else {
            options = [
                { action: 'stop' },
                { action: 'prod1' },
                { action: 'prod2' },
                { action: 'prod3' },
                { action: 'mix' }
            ];
        }

        const topRow = document.createElement('div');
        topRow.className = 'lea-prod-row lea-prod-row-end';

        const bottomRow = document.createElement('div');
        bottomRow.className = 'lea-prod-row lea-prod-row-end';

        menu.className = 'lea-prod-menu theme--light variant--neutral lea-prod-menu-col';

        options.forEach(opt => {
            const optBtn = document.createElement('div');
            optBtn.className = 'bb-base-tile cursor-pointer lea-prod-menu-btn theme--light variant--neutral lea-tile-64';
            optBtn.setAttribute('data-v-d2de3745', '');

            let contentHtml = '';
            if (opt.imgSrc) {
                contentHtml = `<img src="${opt.imgSrc}" draggable="false" class="object-contain size-full object-center" style="width: 100%; height: 100%;">`;
            } else {
                let emoji = '📦';
                if (opt.action === 'stop') emoji = '🛑';
                else if (opt.action === 'mix') emoji = '🔀';
                contentHtml = `<div class="flex items-center justify-center size-full" style="font-size: 32px; width: 100%; height: 100%;">${emoji}</div>`;
            }

            optBtn.innerHTML = `
                <div data-v-25a4a5a3="" class="bb-beveled-tile drop-shadow-(--outer-shadow) **:h-full tile--normal bb-base-tile__background">
                    <div data-v-25a4a5a3="" class="tile__border border border-(--border-color) bg-(--border-color)" style="clip-path: polygon(10px 0px, calc(100% - 10px) 0px, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0px calc(100% - 10px), 0px 10px);">
                        <div data-v-25a4a5a3="" style="--shadow-in-color: #291F02;">
                            <div data-v-25a4a5a3="" class="tile__background flex items-center justify-center [background:var(--bg-gradient)]" style="clip-path: polygon(9.6px 0px, calc(100% - 9.6px) 0px, 100% 9.6px, 100% calc(100% - 9.6px), calc(100% - 9.6px) 100%, 9.6px 100%, 0px calc(100% - 9.6px), 0px 9.6px);"></div>
                        </div>
                    </div>
                </div>
                <div class="bb-base-tile__content p-0.75" style="position: absolute; inset: 0; z-index: 1;">
                    <div class="relative size-full min-h-0 overflow-hidden flex items-center justify-center">
                        ${contentHtml}
                    </div>
                </div>
            `;

            optBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log(`[LEA Auto Prod Change] Option gewählt: ${opt.action}`);
                if (opt.action === 'mix' && cached && cached.products) {
                    if (cached.products.length >= 3) {
                        menu.remove();
                        // Sofort die ersten 3 Produkte auf die 3 Linien verteilen
                        executeProductionChange([
                            cached.products[0].action,
                            cached.products[1].action,
                            cached.products[2].action
                        ]);
                    } else if (cached.products.length === 2) {
                        renderMixSubMenu(menu, anchorBtn, cached.products);
                    } else {
                        menu.remove();
                        executeProductionChange(opt.action);
                    }
                } else {
                    menu.remove();
                    executeProductionChange(opt.action);
                }
            });

            if (opt.action === 'stop' || opt.action === 'mix') {
                topRow.appendChild(optBtn);
            } else {
                bottomRow.appendChild(optBtn);
            }
        });

        menu.appendChild(topRow);
        menu.appendChild(bottomRow);

        // Klick irgendwoanders schließt das Menü
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && e.target !== anchorBtn) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);

        document.body.appendChild(menu);

        // Position korrigieren (Rechtsbündig zum Button)
        const menuRect = menu.getBoundingClientRect();
        menu.style.left = `${rect.right + window.scrollX - menuRect.width}px`;
        menu.style.visibility = 'visible';
    }

    // -----------------------------------------------------------------------
    // SCHRITT 2: Kern-Logik für den Produktwechsel
    // -----------------------------------------------------------------------

    /**
     * Wartet darauf, dass ein Element auf dem Bildschirm erscheint.
     * @param {string} selector - CSS-Selektor
     * @param {number} timeoutMs - Max Wartezeit
     * @returns {Promise<boolean>} true wenn gefunden, false bei Timeout
     */
    async function waitForElementToAppear(selector, timeoutMs = 3000) {
        const startTime = Date.now();
        while (!document.querySelector(selector)) {
            if (Date.now() - startTime > timeoutMs) return false;
            await new Promise(r => setTimeout(r, 50));
        }
        return true;
    }

    /**
     * Wartet darauf, dass ein Element komplett vom Bildschirm verschwindet.
     * @param {string} selector - CSS-Selektor
     * @param {number} timeoutMs - Max Wartezeit
     */
    async function waitForElementToDisappear(selector, timeoutMs = 3000) {
        const startTime = Date.now();
        while (document.querySelector(selector)) {
            if (Date.now() - startTime > timeoutMs) {
                console.warn(`[LEA Auto Prod Change] Timeout: Element ${selector} ist nicht verschwunden.`);
                break;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    }

    /**
     * Führt die ausgewählte Aktion für alle Produktionslinien des Gebäudes aus.
     * @param {string} mode - 'stop', 'prod1', 'prod2', 'prod3' oder 'mix'
     */
    async function executeProductionChange(mode) {
        console.log(`[LEA Auto Prod Change] Starte Änderung für Modus: ${mode}`);

        // Finde initial alle Linien, um die Anzahl zu wissen
        let settingsBtns = Array.from(document.querySelectorAll(SELECTOR_SETTINGS_BTN));
        const numLines = settingsBtns.length;

        if (numLines === 0) {
            console.warn('[LEA Auto Prod Change] Keine Produktionslinien gefunden.');
            return;
        }

        for (let i = 0; i < numLines; i++) {
            // Nach jedem Durchlauf das DOM neu lesen, da sich Elemente durch Navigation ändern
            settingsBtns = Array.from(document.querySelectorAll(SELECTOR_SETTINGS_BTN));
            if (!settingsBtns[i]) break; // Sicherheitshalber abbrechen, falls sich DOM stark verändert hat

            console.log(`[LEA Auto Prod Change] Bearbeite Linie ${i + 1}/${numLines}`);
            settingsBtns[i].click();

            // Warte bis das Einstellungsmenü offen ist (Speichern-Button ist ein guter Indikator)
            await waitForElementToAppear(SELECTOR_SAVE_BTN, 2000);

            const stopBtn = document.querySelector(SELECTOR_STOP_BTN);
            const resBtns = document.querySelectorAll(SELECTOR_RESOURCE_BTN);

            if (!stopBtn && resBtns.length === 0) {
                console.warn('[LEA Auto Prod Change] Menü hat keine Produkt-Buttons. Gehe zurück.');
                const backBtn = document.querySelector(SELECTOR_BACK_BTN);
                if (backBtn) backBtn.click();
                await waitForElementToDisappear(SELECTOR_SAVE_BTN, 2000);
                continue;
            }

            // Ziel-Button bestimmen
            let targetBtn = null;
            if (Array.isArray(mode)) {
                // Modus ist ein Array von Aktionen (z.B. für exakten Mix)
                const action = mode[i % mode.length];
                if (action === 'stop') {
                    targetBtn = stopBtn;
                } else if (action.startsWith('prod')) {
                    const idx = parseInt(action.substring(4), 10) - 1;
                    targetBtn = resBtns[idx] || resBtns[resBtns.length - 1];
                }
            } else if (mode === 'stop') {
                targetBtn = stopBtn;
            } else if (mode.startsWith('prod')) {
                const idx = parseInt(mode.substring(4), 10) - 1;
                targetBtn = resBtns[idx] || resBtns[resBtns.length - 1];
            } else if (mode === 'mix') {
                targetBtn = resBtns[i % resBtns.length]; // Fallback für einfachen Mix
            }

            if (targetBtn) {
                targetBtn.click();

                // Warte kurz, damit der Speichern-Button eventuell aktiviert wird (Spiel-Logik)
                await new Promise(r => setTimeout(r, 300));

                const saveBtn = document.querySelector(SELECTOR_SAVE_BTN);
                if (saveBtn && !saveBtn.disabled) {
                    saveBtn.click();
                    console.log(`[LEA Auto Prod Change] Änderungen gespeichert für Linie ${i + 1}`);

                    // Warte kurz, ob der Bestätigungsdialog auftaucht (falls "Umrüsten" nötig)
                    const dialogAppeared = await waitForElementToAppear(SELECTOR_DIALOG, 500);

                    if (dialogAppeared) {
                        const dialog = document.querySelector(SELECTOR_DIALOG);
                        const okBtn = Array.from(dialog.querySelectorAll('button')).find(btn => btn.textContent.trim() === 'OK');
                        if (okBtn) {
                            console.log(`[LEA Auto Prod Change] Bestätigungsdialog gefunden, klicke OK.`);
                            okBtn.click();
                            await waitForElementToDisappear(SELECTOR_DIALOG, 3000);
                        }
                    }

                    // Prüfe, ob wir noch im Einstellungsmenü sind, und gehe ggf. explizit zurück
                    if (document.querySelector(SELECTOR_SAVE_BTN)) {
                        const backBtn = document.querySelector(SELECTOR_BACK_BTN);
                        if (backBtn) backBtn.click();
                        await waitForElementToDisappear(SELECTOR_SAVE_BTN, 2000);
                    }
                } else {
                    // Wenn nichts geändert wurde (ist schon aktiv), ist Speichern deaktiviert -> einfach Zurück klicken
                    console.log(`[LEA Auto Prod Change] Keine Änderung für Linie ${i + 1} (bereits ausgewählt). Gehe zurück.`);
                    const backBtn = document.querySelector(SELECTOR_BACK_BTN);
                    if (backBtn) backBtn.click();
                    await waitForElementToDisappear(SELECTOR_SAVE_BTN, 2000);
                }
            } else {
                // Fallback, falls kein Button gefunden wurde
                const backBtn = document.querySelector(SELECTOR_BACK_BTN);
                if (backBtn) backBtn.click();
                await waitForElementToDisappear(SELECTOR_SAVE_BTN, 2000);
            }

            // Sehr kurze Pause, bevor die nächste Linie angeklickt wird
            await new Promise(r => setTimeout(r, 100));
        }

        console.log('[LEA Auto Prod Change] Alle Linien abgearbeitet.');
    }

    // -----------------------------------------------------------------------
    // INIT
    // -----------------------------------------------------------------------

    /**
     * Initialisiert das Skript und startet den MutationObserver.
     */
    function init() {
        console.log('[LEA Auto Prod Change] Initialisiert v1.1.1');

        injectProductionChangeButton();

        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    injectProductionChangeButton();
                    isHandlingMutations = false;
                });
            }
        });

        // Wir überwachen DOM-Änderungen, damit der Button auftaucht, wenn man ein Gebäude öffnet
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
