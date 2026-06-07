// ==UserScript==
// @name         LEA Settings
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.0.0
// @match        https://game.logistics-empire.com/*
// @description  Zentrales Einstellungs-Modal für alle LEA Skripte.
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-settings.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-settings.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SETTINGS_BTN_ID = 'lea-settings-gear-btn';
    const SETTINGS_MODAL_ID = 'lea-settings-modal';

    // =========================================================================
    // INITIALISIERUNG & SANITY CHECKS
    // =========================================================================

    if (typeof LEA_CONFIG === 'undefined' || !LEA_CONFIG.settings) {
        console.error('[LEA Settings] LEA_CONFIG oder Settings nicht geladen. Bitte überprüfen Sie, ob lea-shared-helpers.js korrekt geladen wird.');
        return;
    }

    injectGearButton();

    // =========================================================================
    // ZAHNRAD-BUTTON (oben links)
    // =========================================================================

    /**
     * Erstellt den schwebenden Zahnrad-Button oben links im Spiel.
     */
    function injectGearButton() {
        if (document.getElementById(SETTINGS_BTN_ID)) return;

        const btn = document.createElement('button');
        btn.id = SETTINGS_BTN_ID;
        btn.className = 'lea-settings-gear-btn';
        btn.title = 'LEA Einstellungen öffnen';
        btn.textContent = '⚙️';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSettingsModal();
        });

        document.body.appendChild(btn);
    }

    /**
     * Öffnet oder schließt das Settings-Modal per Toggle.
     */
    function toggleSettingsModal() {
        const existing = document.getElementById(SETTINGS_MODAL_ID);
        if (existing) {
            existing.remove();
            return;
        }
        openSettingsModal();
    }

    // =========================================================================
    // SETTINGS MODAL
    // =========================================================================

    /**
     * Erstellt und zeigt das Einstellungs-Modal an.
     */
    function openSettingsModal() {
        const overlay = document.createElement('div');
        overlay.id = SETTINGS_MODAL_ID;
        overlay.className = 'lea-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'lea-modal';

        // Titel
        const title = document.createElement('h3');
        title.className = 'lea-modal-title';
        title.textContent = '⚙️ LEA Einstellungen';
        modal.appendChild(title);

        // Settings-Liste
        const list = document.createElement('div');
        list.className = 'lea-modal-list';

        const inputs = {};

        // Setting: Gebäude-Prefix
        const prefixRow = createSettingRow({
            icon: '🏢',
            label: 'Gebäude-Prefix',
            type: 'text',
            value: LEA_CONFIG.settings.buildingPrefix,
            placeholder: '(AF)'
        });
        list.appendChild(prefixRow.row);
        inputs.buildingPrefix = prefixRow.input;

        // Setting: Max. Lieferzeit
        const timeRow = createSettingRow({
            icon: '⏱️',
            label: 'Max. Lieferzeit (Min)',
            type: 'number',
            value: LEA_CONFIG.settings.maxDeliveryTimeMinutes,
            min: 1,
            max: 120,
            placeholder: '15'
        });
        list.appendChild(timeRow.row);
        inputs.maxDeliveryTimeMinutes = timeRow.input;

        modal.appendChild(list);

        // Buttons
        const btnContainer = document.createElement('div');
        btnContainer.className = 'lea-modal-btn-container';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'lea-modal-close-btn';
        saveBtn.textContent = '💾 Speichern';
        saveBtn.addEventListener('click', () => {
            saveSettingsFromInputs(inputs);
            overlay.remove();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'lea-modal-close-btn lea-modal-cancel-btn';
        cancelBtn.textContent = 'Abbrechen';
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
        });

        btnContainer.appendChild(saveBtn);
        btnContainer.appendChild(cancelBtn);
        modal.appendChild(btnContainer);

        overlay.appendChild(modal);

        // Overlay-Klick schließt Modal
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    // =========================================================================
    // HILFSFUNKTIONEN
    // =========================================================================

    /**
     * Erstellt eine einzelne Settings-Zeile mit Icon, Label und Input-Feld.
     * @param {object} config - Konfiguration der Zeile.
     * @returns {{ row: HTMLElement, input: HTMLInputElement }}
     */
    function createSettingRow({ icon, label, type, value, placeholder, min, max }) {
        const row = document.createElement('div');
        row.className = 'lea-modal-row lea-settings-row';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'lea-modal-label';
        labelSpan.innerHTML = `<span>${icon}</span> <span>${label}</span>`;

        const input = document.createElement('input');
        input.type = type;
        input.value = value;
        input.className = 'lea-settings-input';
        if (placeholder) input.placeholder = placeholder;
        if (min !== undefined) input.min = String(min);
        if (max !== undefined) input.max = String(max);

        row.appendChild(labelSpan);
        row.appendChild(input);

        return { row, input };
    }

    /**
     * Liest die Werte aus den Input-Feldern und speichert sie in LEA_CONFIG.settings.
     * @param {object} inputs - Map von Setting-Key zu Input-Element.
     */
    function saveSettingsFromInputs(inputs) {
        LEA_CONFIG.settings.buildingPrefix = inputs.buildingPrefix.value.trim() || LEA_CONFIG.SETTINGS_DEFAULTS.buildingPrefix;
        LEA_CONFIG.settings.maxDeliveryTimeMinutes = parseInt(inputs.maxDeliveryTimeMinutes.value) || LEA_CONFIG.SETTINGS_DEFAULTS.maxDeliveryTimeMinutes;

        LEA_CONFIG.saveSettings();
        showToast('✅ Einstellungen gespeichert!');
    }

})();
