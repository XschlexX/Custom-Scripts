// ==UserScript==
// @name         LEA Auto Fill Goods
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.1.17
// @match        https://game.logistics-empire.com/*
// @description  Füllt Waren im Lager gleichmäßig bis zur maximalen Kapazität auf.
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-fill-goods.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-fill-goods.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // KONFIGURATION & SELEKTOREN
    // =========================================================================
    const INJECT_BTN_ID = 'lea-auto-fill-btn';
    const BTN_INJECT_SELECTOR = LEA_CONFIG.MANAGE_BUILDING_SELECTOR;
    const INPUT_CONTAINER_SELECTOR = LEA_CONFIG.INPUT_CONTAINER_SELECTOR;

    // =========================================================================
    // HAUPT-LOGIK
    // =========================================================================

    // Helper: Liest den aktuell im Eingabefeld angezeigten Wert aus (über Shadow DOM oder Fallback)
    function getTypedValue(inputContainer) {
        if (!inputContainer) return 0;
        
        const flowEl = inputContainer.querySelector('number-flow-vue');
        if (flowEl && flowEl.shadowRoot) {
            const intDigits = flowEl.shadowRoot.querySelectorAll('[part~="integer-digit"]');
            let intStr = '';
            intDigits.forEach(d => {
                const m = (d.getAttribute('style') || '').match(/--current:\s*(\d+)/);
                if (m) intStr += m[1];
            });
            if (intStr) {
                const fracDigits = flowEl.shadowRoot.querySelectorAll('[part~="fraction-digit"]');
                let fracStr = '';
                fracDigits.forEach(d => {
                    const m = (d.getAttribute('style') || '').match(/--current:\s*(\d+)/);
                    if (m) fracStr += m[1];
                });
                const suffixEl = flowEl.shadowRoot.querySelector('[part~="suffix"]');
                const suffix = suffixEl ? suffixEl.textContent.trim() : '';
                const numStr = fracStr ? `${intStr}.${fracStr}${suffix}` : `${intStr}${suffix}`;
                return parseAmount(numStr);
            }
        }
        
        // Fallback: Textinhalt direkt bereinigen
        const text = (inputContainer.textContent || '').trim();
        const cleanText = text.replace(/[.,\s]/g, '');
        return parseInt(cleanText) || 0;
    }

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

        // Die Waren im Spiel sind bereits von links (meiste) nach rechts (wenigste) vorsortiert.
        // Die MAX-Ware (meiste Ware) ist somit der erste Eintrag (ganz links).
        const maxGood = goodsInfo[0]; 
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

        // Helper: Übergeordnetes Lieferanten-Kachel-Element finden
        function findSupplierCard(inputContainer) {
            let el = inputContainer.parentElement;
            while (el && el !== document.body) {
                if (el.querySelector('[data-tutorial-id="transport-source-distance"]')) {
                    return el;
                }
                el = el.parentElement;
            }
            return null;
        }



        // Helper: Entfernung für einen Lieferanten auslesen
        function getSupplierDistance(supplierCard) {
            if (!supplierCard) return null;
            const distanceEl = supplierCard.querySelector('[data-tutorial-id="transport-source-distance"]');
            if (!distanceEl) return null;

            const text = distanceEl.textContent || '';
            const match = text.match(/([\d.,]+)\s*km/i);
            if (!match) return null;

            let valStr = match[1];
            if (valStr.includes(',')) {
                valStr = valStr.replace(/\./g, '').replace(',', '.');
            }
            const num = parseFloat(valStr);
            return isNaN(num) ? null : num;
        }

        // Filtere Lieferanten nach maximaler Entfernung
        const maxDistance = LEA_CONFIG.settings.maxSupplierDistanceKm || 150;
        console.log(`[LEA Auto Fill] Maximale Lieferanten-Entfernung: ${maxDistance} km`);

        const validContainers = [];
        let excludedCount = 0;

        for (const inputContainer of document.querySelectorAll(INPUT_CONTAINER_SELECTOR)) {
            const supplierCard = findSupplierCard(inputContainer);
            const distance = getSupplierDistance(supplierCard);
            const name = supplierCard ? (supplierCard.textContent || '').trim().split('\n')[0].trim().substring(0, 45) : 'Unbekannter Lieferant';

            if (distance === null) {
                console.log(`[LEA Auto Fill] Ignoriere Feld bei "${name}" (Entfernung konnte nicht ausgelesen werden).`);
                excludedCount++;
                continue;
            }
            if (distance > maxDistance) {
                console.log(`[LEA Auto Fill] Ignoriere Feld bei "${name}" (${distance} km > ${maxDistance} km).`);
                excludedCount++;
                continue;
            }
            validContainers.push(inputContainer);
        }

        if (excludedCount > 0) {
            console.log(`[LEA Auto Fill] Insgesamt ${excludedCount} Lieferanten-Eingabefelder gefiltert.`);
        }

        const allInputContainers = validContainers;
        console.log(`[LEA Auto Fill] ${allInputContainers.length} gültige Lieferanten-Eingabefelder gefunden.`);

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
        // Wir arbeiten die Waren von rechts (wenigste Ware) nach links (meiste Ware, ohne MAX-Ware) ab.
        for (let i = goodsInfo.length - 1; i >= 1; i--) {
            const good = goodsInfo[i];
            if (good.imgSrc === maxGoodSrc) continue;
            if (!remaining[good.imgSrc] || remaining[good.imgSrc] <= 0) continue;

            console.log(`[LEA Auto Fill] Befülle Sorte: ${good.imgSrc.split('/').pop().replace('.avif', '')} (fehlt: ${remaining[good.imgSrc]})`);

            const matchingContainers = allInputContainers.filter(inputContainer => {
                const { goodsImg } = findRowAndImg(inputContainer);
                return goodsImg && goodsImg.getAttribute('src') === good.imgSrc;
            });

            for (const inputContainer of matchingContainers) {
                if (remaining[good.imgSrc] <= 0) break;

                const { rowEl, goodsImg } = findRowAndImg(inputContainer);
                if (!goodsImg) continue;

                // Lieferant-Bestand: LETZTER non-input flow = aktueller Lagerbestand des Lieferanten.
                // Die Kachel zeigt [Bereits angefordert (meist 0) / Gesamtbestand]. Der letzte non-input flow ist der Bestand.
                const supplierFlows = rowEl ? Array.from(rowEl.querySelectorAll('number-flow-vue'))
                    .filter(f => !inputContainer.contains(f)) : [];
                let supplierMax = 0;
                if (supplierFlows.length > 0) {
                    const targetFlow = supplierFlows[supplierFlows.length - 1];
                    supplierMax = getNumberFromFlow(targetFlow);
                }
                if (supplierMax <= 0) continue; // Lieferant hat nichts auf Lager

                const amountToTake = Math.min(remaining[good.imgSrc], supplierMax);
                const name = good.imgSrc.split('/').pop().replace('.avif', '');
                console.log(`  ${name}: nehme ${amountToTake} (Lieferant Bestand: ${supplierMax})`);

                await simulateTyping(inputContainer, amountToTake);
                remaining[good.imgSrc] -= amountToTake;

                if (goodsImg) simulateClick(goodsImg);
                inputContainer.blur(); // Fokussierung aufheben, um den Wert im Spiel zu registrieren (commit)

                // Warte dynamisch, bis der Wert im DOM aktualisiert wurde (maximal 500ms)
                let actualTyped = 0;
                const startTime = Date.now();
                while (Date.now() - startTime < 500) {
                    actualTyped = getTypedValue(inputContainer);

                    // Wenn der eingetippte Wert erreicht wurde oder sich auf einen plausiblen Wert geändert hat
                    if (actualTyped === amountToTake || (actualTyped > 0 && actualTyped < amountToTake)) {
                        break;
                    }
                    await wait(30);
                }

                if (actualTyped > 0 && actualTyped !== amountToTake) {
                    console.log(`  [LEA Auto Fill] Korrigiere: Eingetippt wurde ${amountToTake}, das Spiel hat es auf ${actualTyped} angepasst.`);
                    const diff = amountToTake - actualTyped;
                    remaining[good.imgSrc] += diff; // Differenz dem Bedarf wieder hinzufügen
                }
            }
        }

        await wait(200); // Kurze Atempause für DOM/Reaktivität

        // Freien Speicherplatz berechnen (mathematisch exakt und absolut unabhängig von UI-Verzögerungen)
        let plannedStock = 0;
        for (const good of goodsInfo) {
            if (good.imgSrc === maxGoodSrc) {
                plannedStock += good.currentAmount;
            } else {
                const typedAmount = good.missingAmount - (remaining[good.imgSrc] || 0);
                plannedStock += good.currentAmount + typedAmount;
            }
        }
        let freeSpace = Math.max(0, totalCapacity - plannedStock);
        console.log(`[LEA Auto Fill] Freier Lagerplatz (berechnet): ${freeSpace}`);

        // Toleranzwert für Rundungsfehler bestimmen (basierend auf der Größe der MAX-Ware)
        function getRoundingTolerance(amount) {
            if (amount >= 1000000) return 150000; // Millionen-Bereich (M)
            if (amount >= 1000) return 150;      // Tausender-Bereich (K)
            return 5;                            // Exakter Bereich
        }
        const tolerance = getRoundingTolerance(maxGood.currentAmount);
        console.log(`[LEA Auto Fill] Rundungstoleranz für MAX-Ware: ${tolerance} (Menge: ${maxGood.currentAmount})`);

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

            // Lieferanten-Bestand für Logging, Loop-Counter und Weichenentscheidung
            const supplierFlows = rowEl ? Array.from(rowEl.querySelectorAll('number-flow-vue'))
                .filter(f => !inputContainer.contains(f)) : [];
            let supplierMax = 0;
            if (supplierFlows.length > 0) {
                const targetFlow = supplierFlows[supplierFlows.length - 1];
                supplierMax = getNumberFromFlow(targetFlow);
            }
            if (supplierMax <= 0) continue; // Lieferant hat nichts auf Lager

            // Differenz berechnen zwischen freiem Lagerplatz und berechnetem Bedarf
            const difference = freeSpace - maxGoodRemaining;

            // Fall A: Genügend freier Platz im Lager und beim Lieferanten vorhanden (echter freier Platz)
            if (difference > tolerance && supplierMax > maxGoodRemaining) {
                console.log(`  ${maxGoodName}: Tippe ${maxGoodRemaining} ein (freier Platz ${freeSpace} > Bedarf ${maxGoodRemaining} [Diff ${difference} > Toleranz ${tolerance}]).`);
                await simulateTyping(inputContainer, maxGoodRemaining);
                inputContainer.blur();

                // Warte dynamisch auf das Update im DOM
                let actualTyped = 0;
                const startTime = Date.now();
                while (Date.now() - startTime < 500) {
                    actualTyped = getTypedValue(inputContainer);
                    if (actualTyped === maxGoodRemaining || (actualTyped > 0 && actualTyped < maxGoodRemaining)) {
                        break;
                    }
                    await wait(30);
                }

                if (actualTyped > 0) {
                    maxGoodRemaining -= actualTyped;
                    freeSpace -= actualTyped;
                } else {
                    maxGoodRemaining = 0; // Fallback
                }
                await wait(100);
            } else {
                // Fall B: Lagerplatz ist der limitierende Faktor (Ausgleich des Rundungsfehlers) -> Klick auf MAX
                // Schritt 1: Eingabefeld fokussieren
                inputContainer.focus();
                await wait(100);

                // Schritt 2: MAX-Button suchen
                const parent = inputContainer.parentElement;
                let maxBtn = parent ? Array.from(parent.querySelectorAll('button')).find(b => b.textContent.trim() === 'MAX') : null;
                if (!maxBtn && rowEl) {
                    maxBtn = Array.from(rowEl.querySelectorAll('button')).find(b => b.textContent.trim() === 'MAX');
                }

                if (maxBtn) {
                    console.log(`  ${maxGoodName}: MAX-Button klicken. (Lagerplatz: ${freeSpace}, Lieferant: ${supplierMax}, noch benötigt: ${maxGoodRemaining})`);
                    simulateClick(maxBtn);
                    maxButtonClicked = true;

                    // Warte dynamisch auf das Update im DOM
                    let actualTyped = 0;
                    const startTime = Date.now();
                    while (Date.now() - startTime < 500) {
                        actualTyped = getTypedValue(inputContainer);
                        if (actualTyped > 0) {
                            break;
                        }
                        await wait(30);
                    }

                    const amountDeducted = actualTyped > 0 ? actualTyped : (supplierMax || 1);
                    maxGoodRemaining -= amountDeducted;
                    freeSpace -= amountDeducted;
                    await wait(100);
                } else {
                    console.warn(`[LEA Auto Fill] MAX-Button für Lieferant nicht gefunden (rowEl-Klassen: ${rowEl?.className?.slice(0, 60)})`);
                }
            }
        }

        // Auswertung
        for (const [src, rest] of Object.entries(remaining)) {
            if (rest > 0) console.warn(`[LEA Auto Fill] Noch ${rest} fehlend für "${src.split('/').pop().replace('.avif', '')}" – kein Lieferant mit ausreichend Bestand.`);
        }
        if (maxGood.missingAmount > 0 && !maxButtonClicked) {
            console.warn(`[LEA Auto Fill] MAX-Button für "${maxGoodName}" nicht gefunden!`);
        }

        // Abschließender Blur auf das aktuell fokussierte Element, um sicherzustellen,
        // dass alle Eingaben im Spiel registriert wurden.
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }

        console.log("[LEA Auto Fill] Abgeschlossen.");
        document.dispatchEvent(new CustomEvent('lea-auto-fill-finished', { detail: { success: true } }));
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
        console.log('[LEA Auto Fill] Initialisiert v1.1.17');

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
