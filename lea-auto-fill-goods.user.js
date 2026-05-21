// ==UserScript==
// @name         LEA Auto Fill Goods
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.1.2
// @match        https://game.logistics-empire.com/*
// @description  Füllt Waren im Lager gleichmäßig bis zur maximalen Kapazität auf.
// @grant        none
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-fill-goods.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-fill-goods.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & SELEKTOREN
    // =========================================================================
    const INJECT_BTN_ID = 'lea-auto-fill-btn';
    const BTN_INJECT_SELECTOR = 'button[data-tutorial-id="manage-building-button"]';
    const INPUT_CONTAINER_SELECTOR = '.bb-label-container[tabindex="0"]';

    // =========================================================================
    // HILFSFUNKTIONEN
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
                console.warn(`[LEA Auto Fill] Timeout: Element ${selector} ist nicht verschwunden.`);
                break;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    }

    // Parses a formatted number string (e.g. "1K", "1.5K", "500", "3,5K") into an integer.
    function parseAmount(str) {
        if (!str) return 0;
        str = str.toUpperCase().trim();
        let multiplier = 1;
        if (str.endsWith('K')) {
            multiplier = 1000;
            str = str.slice(0, -1);
        } else if (str.endsWith('M')) {
            multiplier = 1000000;
            str = str.slice(0, -1);
        }
        str = str.replace(',', '.');
        const num = parseFloat(str);
        return isNaN(num) ? 0 : Math.floor(num * multiplier);
    }

    // Extracts the full number from a <number-flow-vue> element by reading aria-label or the rendered digits.
    function getNumberFromFlow(element) {
        if (!element) return 0;
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) {
            return parseAmount(ariaLabel);
        }
        return 0;
    }

    // Simulate clicking on an element
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

    // Wait helper
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Simulate typing into a custom Vue number input (div with tabindex="0").
    // Uses element.focus() (NOT simulateClick) to avoid bubbling to panel--status--interactable.
    // Dispatches to both element and document since Vue may listen at window-level.
    async function simulateTyping(element, text) {
        if (!element) return;

        element.focus();
        await wait(50);

        const str = text.toString();

        document.execCommand('selectAll', false, null);
        const inserted = document.execCommand('insertText', false, str);

        if (!inserted) {
            const targets = [element, document];
            for (let i = 0; i < 6; i++) {
                targets.forEach(t => {
                    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }));
                    t.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true }));
                });
            }
            for (const char of str) {
                const keyCode = char.charCodeAt(0);
                targets.forEach(t => {
                    t.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: 'Digit' + char, keyCode, which: keyCode, bubbles: true, cancelable: true }));
                    t.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: 'Digit' + char, keyCode, which: keyCode, charCode: keyCode, bubbles: true, cancelable: true }));
                    t.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: 'Digit' + char, keyCode, which: keyCode, bubbles: true, cancelable: true }));
                });
            }
        }

        // Enter: Wert committen
        [element, document].forEach(t => {
            t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            t.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        });
        await wait(30);
    }

    // =========================================================================
    // HAUPT-LOGIK
    // =========================================================================

    async function handleAutoFill() {
        console.log("[LEA Auto Fill] Start...");

        // 1. Kapazität lesen (auf der Übersichtsseite)
        const capacityHeader = document.querySelector('h2.text-h2');
        if (!capacityHeader || !capacityHeader.textContent.includes('Kapazität:')) {
            console.error("[LEA Auto Fill] Kapazität nicht gefunden auf der Übersichtsseite.");
            return;
        }
        const totalCapacity = parseAmount(capacityHeader.textContent.replace('Kapazität:', '').trim());
        console.log("[LEA Auto Fill] Gesamtkapazität:", totalCapacity);

        // 2. "Intern anfordern" klicken BEVOR die Waren gelesen werden
        const internBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Intern anfordern'));
        if (internBtn) {
            console.log("[LEA Auto Fill] Klicke auf 'Intern anfordern'...");
            simulateClick(internBtn);
            // Nutze waitForElementToAppear anstatt eines fixen Timeouts!
            await waitForElementToAppear(INPUT_CONTAINER_SELECTOR, 3000);
            await wait(100); // Kurzer Puffer für UI Render
        } else {
            console.warn("[LEA Auto Fill] Button 'Intern anfordern' nicht gefunden!");
        }

        // 3. Warensorten lesen und nach aktuellem Bestand aufsteigend sortieren
        //    Wir suchen nur im spezifischen Container für die Warenübersicht, um Lieferanten-Kacheln auszuschließen.
        const requestedResourcesContainer = document.querySelector('[data-tutorial-id="transport-requested-resources"]');
        if (!requestedResourcesContainer) {
            console.error("[LEA Auto Fill] Container für Warensorten nicht gefunden.");
            return;
        }

        const goodsTiles = Array.from(requestedResourcesContainer.querySelectorAll('.bb-base-tile'))
            .filter(tile => tile.querySelector('img.object-contain'));

        if (goodsTiles.length === 0) {
            console.error("[LEA Auto Fill] Keine Warensorten im Bestand gefunden.");
            return;
        }

        const numTypes = goodsTiles.length;
        const targetPerType = Math.floor(totalCapacity / numTypes);
        const goodsInfo = [];

        goodsTiles.forEach(tile => {
            const imgEl = tile.querySelector('img.object-contain');
            if (!imgEl) return;
            const imgSrc = imgEl.getAttribute('src');
            const flows = tile.querySelectorAll('number-flow-vue');
            const currentAmount = flows.length > 0 ? getNumberFromFlow(flows[0]) : 0;
            goodsInfo.push({ imgSrc, currentAmount, missingAmount: Math.max(0, targetPerType - currentAmount) });
        });

        // Aufsteigend sortieren: wenigste zuerst → MAX-Ware ist der letzte Eintrag
        goodsInfo.sort((a, b) => a.currentAmount - b.currentAmount);

        const maxGood = goodsInfo[goodsInfo.length - 1]; // meiste Ware → MAX-Button
        const maxGoodSrc = maxGood.imgSrc;
        const maxGoodName = maxGoodSrc.split('/').pop().replace('.avif', '');

        console.log(`[LEA Auto Fill] Gefunden: ${numTypes} Sorten, Ziel: ${targetPerType} pro Sorte.`);
        console.log(`[LEA Auto Fill] MAX-Ware (links/meiste): ${maxGoodName}`);
        goodsInfo.forEach(g => console.log(`  ${g.imgSrc.split('/').pop().replace('.avif', '')} aktuell=${g.currentAmount}, fehlt=${g.missingAmount}`));

        // 4. Fehlmengen-Map aufbauen – NUR für Sorten, die eingetippt werden (nicht MAX-Ware)
        const remaining = {};
        for (const good of goodsInfo) {
            if (good.imgSrc === maxGoodSrc) continue; // MAX-Ware wird per Button gefüllt
            if (good.missingAmount > 0) {
                remaining[good.imgSrc] = good.missingAmount;
                console.log(`[LEA Auto Fill] Sorte benötigt ${good.missingAmount} Stück: ${good.imgSrc.split('/').pop().replace('.avif', '')}`);
            }
        }

        // Helper: Warenbild für ein inputContainer finden (bis 6 Ebenen hoch)
        function findRowAndImg(inputContainer) {
            let rowEl = inputContainer.parentElement;
            let goodsImg = null;
            for (let d = 0; d < 6 && rowEl; d++) {
                goodsImg = rowEl.querySelector('img.object-contain');
                if (goodsImg) break;
                rowEl = rowEl.parentElement;
            }
            return { rowEl, goodsImg };
        }

        const allInputContainers = Array.from(document.querySelectorAll(INPUT_CONTAINER_SELECTOR));
        console.log(`[LEA Auto Fill] ${allInputContainers.length} Lieferanten-Eingabefelder gefunden.`);

        // Zentrallager (ZL) priorisieren
        function isZLCenter(inputContainer) {
            let el = inputContainer;
            for (let i = 0; i < 10; i++) {
                if (!el) break;
                // Verhindern, dass wir im Parent der gesamten Liste suchen
                if (allInputContainers.length > 1 && el.querySelectorAll(INPUT_CONTAINER_SELECTOR).length === allInputContainers.length) {
                    break;
                }
                if (el.textContent.includes('(ZL)')) {
                    return true;
                }
                el = el.parentElement;
            }
            return false;
        }

        allInputContainers.sort((a, b) => {
            const aIsZL = isZLCenter(a);
            const bIsZL = isZLCenter(b);
            if (aIsZL && !bIsZL) return -1;
            if (!aIsZL && bIsZL) return 1;
            return 0;
        });

        const zlCount = allInputContainers.filter(isZLCenter).length;
        if (zlCount > 0) {
            console.log(`[LEA Auto Fill] ${zlCount} Zentrallager (ZL) priorisiert.`);
        }

        // ── Phase 1: Fehlmengen eintippen (MAX-Ware komplett überspringen) ──
        for (const inputContainer of allInputContainers) {
            const { rowEl, goodsImg } = findRowAndImg(inputContainer);
            if (!goodsImg) continue;
            const imgSrc = goodsImg.getAttribute('src');

            if (imgSrc === maxGoodSrc) continue;       // MAX-Ware → erst in Phase 2
            if (!(imgSrc in remaining)) continue;
            if (remaining[imgSrc] <= 0) continue;

            // Lieferant-Max ermitteln (letzter flow-Wert > 0 der nicht im Input-Feld liegt)
            let supplierMax = 0;
            const flows = rowEl ? Array.from(rowEl.querySelectorAll('number-flow-vue')) : [];
            for (let fi = flows.length - 1; fi >= 0; fi--) {
                if (inputContainer.contains(flows[fi])) continue;
                const val = parseAmount(flows[fi].getAttribute('aria-label') || '');
                if (val > 0) { supplierMax = val; break; }
            }
            if (supplierMax <= 0) continue;

            const amountToTake = Math.min(remaining[imgSrc], supplierMax);
            const name = imgSrc.split('/').pop().replace('.avif', '');
            console.log(`  ${name}: nehme ${amountToTake} (Lieferant max ${supplierMax})`);

            await simulateTyping(inputContainer, amountToTake);
            remaining[imgSrc] -= amountToTake;

            if (goodsImg) simulateClick(goodsImg);
            await wait(50);
        }

        await wait(100);

        // ── Phase 2: MAX-Ware befüllen ──
        // Erst das Eingabefeld der MAX-Ware fokussieren – das committet den zuletzt
        // getippten Wert (black_potato) über den blur-Event, genau wie ein manueller Klick.
        // Dann iterieren wir über die Lieferanten der MAX-Ware, bis der Bedarf gedeckt ist.
        let maxButtonClicked = false;
        let maxGoodRemaining = maxGood.missingAmount;

        for (const inputContainer of allInputContainers) {
            if (maxGoodRemaining <= 0) break; // Bedarf bereits gedeckt

            const { rowEl, goodsImg } = findRowAndImg(inputContainer);
            if (!goodsImg) continue;
            if (goodsImg.getAttribute('src') !== maxGoodSrc) continue;

            // Lieferant-Max ermitteln
            let supplierMax = 0;
            const flows = rowEl ? Array.from(rowEl.querySelectorAll('number-flow-vue')) : [];
            for (let fi = flows.length - 1; fi >= 0; fi--) {
                if (inputContainer.contains(flows[fi])) continue;
                const val = parseAmount(flows[fi].getAttribute('aria-label') || '');
                if (val > 0) { supplierMax = val; break; }
            }
            if (supplierMax <= 0) continue;

            // Schritt 1: Eingabefeld der MAX-Ware fokussieren → committed vorherige Werte
            inputContainer.focus();
            await wait(100);

            // Schritt 2: MAX-Button klicken
            const maxBtn = Array.from(rowEl.querySelectorAll('button')).find(b => b.textContent.trim() === 'MAX');
            if (maxBtn) {
                console.log(`  ${maxGoodName}: MAX-Button klicken. (Lieferant hat ${supplierMax}, noch benötigt: ${maxGoodRemaining})`);
                simulateClick(maxBtn);
                maxButtonClicked = true;
                maxGoodRemaining -= supplierMax;
                await wait(200);
            }
        }

        // Auswertung
        for (const [src, rest] of Object.entries(remaining)) {
            if (rest > 0) console.warn(`[LEA Auto Fill] Noch ${rest} fehlend für "${src.split('/').pop().replace('.avif', '')}" – kein Lieferant mit ausreichend Bestand.`);
        }
        if (!maxButtonClicked) console.warn(`[LEA Auto Fill] MAX-Button für "${maxGoodName}" nicht gefunden!`);

        console.log("[LEA Auto Fill] Abgeschlossen.");
    }

    // =========================================================================
    // UI INJECTION
    // =========================================================================

    function injectButton() {
        const editBtn = document.querySelector(BTN_INJECT_SELECTOR);
        if (!editBtn) {
            const existingBtn = document.getElementById(INJECT_BTN_ID);
            if (existingBtn) existingBtn.remove();
            return;
        }

        // Prüfen, ob es sich um ein Lager handelt (anhand typischer Elemente)
        const isStorage = Array.from(document.querySelectorAll('.text-h2, h2')).some(el => el.textContent.includes('Kapazität:')) ||
            Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Intern anfordern'));

        if (!isStorage) {
            const existingBtn = document.getElementById(INJECT_BTN_ID);
            if (existingBtn) existingBtn.remove();
            return;
        }

        if (document.getElementById(INJECT_BTN_ID)) return;

        const headerContainer = editBtn.parentNode;

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md shape--square theme--light lea-injected-btn';
        btn.title = 'Gleichmäßig Auffüllen';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.innerHTML = 'Fill<br>Up';
        btn.appendChild(inner);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleAutoFill();
        });

        // Button vor dem Edit-Button einfügen (links davon)
        headerContainer.insertBefore(btn, editBtn);
    }

    // =========================================================================
    // INITIALISIERUNG
    // =========================================================================

    function init() {
        console.log('[LEA Auto Fill] Initialisiert v1.0.3');

        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    injectButton();
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
