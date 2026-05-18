// ==UserScript==
// @name         LEA Auto Produktion Change
// @namespace    le-tools
// @version      1.1.0
// @match        https://game.logistics-empire.com/*
// @description  Aendert die Produktion in den Produktionslinien per Knopfdruck.
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/refs/heads/main/lea-auto-produktion-change.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/refs/heads/main/lea-auto-produktion-change.js
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
        btn.className = 'bb-base-button variant--neutral size--md theme--light lea-injected-btn';
        btn.title = 'Produktion ändern';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.textContent = 'Prod.\nändern';
        btn.appendChild(inner);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showProductionSelectionMenu(btn);
        });

        // Button vor dem Edit-Button einfügen
        headerContainer.insertBefore(btn, editBtn);
        console.log('[LEA Auto Prod Change] Button eingefügt.');
    }

    /**
     * Zeigt das Dropdown-Menü zur Auswahl der Aktion (Stop, Produkt 1-3, Mix).
     * @param {HTMLElement} anchorBtn - Der Button, unter dem das Menü auftauchen soll.
     */
    function showProductionSelectionMenu(anchorBtn) {
        // Schließe existierendes Menü, falls offen
        const existing = document.getElementById(MENU_ID);
        if (existing) {
            existing.remove();
            return;
        }

        const menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.className = 'lea-prod-menu';

        // Positioniere das Menü unter dem Button
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY + 10}px`;
        menu.style.left = `${rect.left + window.scrollX}px`;

        // Optionen: Stop, Prod 1, Prod 2, Prod 3, Verschiedene
        const options = [
            { label: 'Stop', action: 'stop' },
            { label: 'Produkt 1', action: 'prod1' },
            { label: 'Produkt 2', action: 'prod2' },
            { label: 'Produkt 3', action: 'prod3' },
            { label: 'Verschiedene', action: 'mix' }
        ];

        options.forEach(opt => {
            const optBtn = document.createElement('button');
            optBtn.textContent = opt.label;
            optBtn.className = 'bb-base-button variant--normal size--sm theme--light lea-prod-menu-btn';

            // Wir belassen den gelben Button-Hintergrund des Spiels und ändern nur die Schriftfarbe
            let textColor = '#2980b9'; // Standard: Blau für Produkte
            if (opt.action === 'stop') textColor = '#c0392b'; // Rot für Stop
            if (opt.action === 'mix') textColor = '#27ae60'; // Grün für Verschiedene

            optBtn.style.setProperty('color', textColor, 'important');

            optBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log(`[LEA Auto Prod Change] Option gewählt: ${opt.label}`);
                menu.remove();
                executeProductionChange(opt.action);
            });
            menu.appendChild(optBtn);
        });

        // Klick irgendwoanders schließt das Menü
        const closeMenu = (e) => {
            if (!menu.contains(e.target) && e.target !== anchorBtn) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        // Kurze Verzögerung, damit der aktuelle Klick nicht sofort das Menü schließt
        setTimeout(() => document.addEventListener('click', closeMenu), 0);

        document.body.appendChild(menu);
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
            if (mode === 'stop') {
                targetBtn = stopBtn;
            } else if (mode === 'prod1') {
                targetBtn = resBtns[0];
            } else if (mode === 'prod2') {
                targetBtn = resBtns[1] || resBtns[0];
            } else if (mode === 'prod3') {
                targetBtn = resBtns[2] || resBtns[1] || resBtns[0];
            } else if (mode === 'mix') {
                targetBtn = resBtns[i % resBtns.length]; // Z.B. Linie 1->Prod 1, Linie 2->Prod 2, Linie 3->Prod 3
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
        console.log('[LEA Auto Prod Change] Initialisiert v1.0.0');

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
