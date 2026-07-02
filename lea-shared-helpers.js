// ==UserScript==
// @name         LEA Shared Helpers
// @namespace    lea-tools
// @version      1.0.15
// @description  Gemeinsame Hilfsfunktionen und Konstanten für LEA Assistant Skripte.
// @author       DonSanchos
// @match        https://game.logistics-empire.com/*
// @grant        none
// ==/UserScript==

// =========================================================================
// GETEILTE KONSTANTEN
// =========================================================================
if (typeof window.LEA_CONFIG === 'undefined') {
    window.LEA_CONFIG = {
        INPUT_CONTAINER_SELECTOR: '.bb-label-container[tabindex="0"]',
        ASSISTANT_BTN_SELECTOR: 'button[data-tutorial-id="transport-assistant"]',
        NEXT_STEP_BTN_SELECTOR: 'button[data-tutorial-id="transport-next-step"]',
        FILTER_BAR_SELECTOR: '.bb-filter-and-sort-bar',
        MANAGE_BUILDING_SELECTOR: 'button[data-tutorial-id="manage-building-button"]',
        SETTINGS_BTN_SELECTOR: 'button[data-tutorial-id="factory-line-settings-button"]',
        BACK_BTN_SELECTOR: '.bottom-navigation button[show-divider]',
        DIALOG_SELECTOR: '.bb-dialog',
        ARROW_BTN_SELECTOR: 'img[src*="to_quest_objective"], img[src*="tobuildingpage"]',

        // Assistenten-Buttons (Bilder zur Erkennung)
        IMG_AUTO_SELECT: 'auto_select',
        IMG_CONTINUE: ['in_progress', 'button-continue', 'button_continue'],

        // Handelszentrum-Spezifisches
        ALL_REWARDS_BTN_SELECTOR: 'button.variant--normal img[src*="collect_order"]',
        HANDELSZENTRUM_HEADER_SRC: 'img[src*="page_header_orders-"]'
    };

    // =========================================================================
    // SETTINGS-MANAGEMENT (localStorage-basiert)
    // =========================================================================
    window.LEA_CONFIG.SETTINGS_KEY = 'lea-settings';
    window.LEA_CONFIG.SETTINGS_DEFAULTS = {
        buildingPrefix: '(AF)',
        storagePrefix: '(LS)',
        minEmptyPercentage: 30,
        maxOrderDeliveryTimeMinutes: 15,
        maxSupplyDeliveryTimeMinutes: 15,
        excludeUpgradeNames: '',
        excludeOrderNames: '',
        maxSupplierDistanceKm: 150
    };

    let cachedSettings = null;

    /**
     * Lädt gespeicherte Einstellungen aus localStorage und merged sie mit den Defaults.
     * Definiert als Getter/Setter mit lokalem Cache, damit Eigenschafts-Zuweisungen (z.B. LEA_CONFIG.settings.x = y)
     * nicht verloren gehen und rückwärtskompatibel mit älteren Skript-Versionen sind.
     */
    Object.defineProperty(window.LEA_CONFIG, 'settings', {
        get: function () {
            if (cachedSettings) return cachedSettings;
            try {
                const stored = localStorage.getItem('lea-settings');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    // Migration für alte maxDeliveryTimeMinutes Einstellung
                    if (parsed.maxDeliveryTimeMinutes !== undefined) {
                        if (parsed.maxOrderDeliveryTimeMinutes === undefined) {
                            parsed.maxOrderDeliveryTimeMinutes = parsed.maxDeliveryTimeMinutes;
                        }
                        if (parsed.maxSupplyDeliveryTimeMinutes === undefined) {
                            parsed.maxSupplyDeliveryTimeMinutes = parsed.maxDeliveryTimeMinutes;
                        }
                        delete parsed.maxDeliveryTimeMinutes;
                    }
                    cachedSettings = { ...window.LEA_CONFIG.SETTINGS_DEFAULTS, ...parsed };
                    return cachedSettings;
                }
            } catch (e) {
                console.warn('[LEA Helpers] Settings konnten nicht geladen werden:', e);
            }
            cachedSettings = { ...window.LEA_CONFIG.SETTINGS_DEFAULTS };
            return cachedSettings;
        },
        set: function (newVal) {
            cachedSettings = newVal;
        },
        configurable: true,
        enumerable: true
    });

    /**
     * Speichert die angegebenen Settings in localStorage und dispatcht ein CustomEvent.
     * Andere Skripte können auf 'lea-settings-changed' lauschen.
     */
    window.LEA_CONFIG.saveSettings = function (settings) {
        try {
            const dataToSave = settings || window.LEA_CONFIG.settings;
            localStorage.setItem('lea-settings', JSON.stringify(dataToSave));
            cachedSettings = dataToSave;
            document.dispatchEvent(new CustomEvent('lea-settings-changed', { detail: { ...dataToSave } }));
            console.log('[LEA Helpers] Settings gespeichert:', dataToSave);
        } catch (e) {
            console.error('[LEA Helpers] Settings konnten nicht gespeichert werden:', e);
        }
    };

    // Event-Listener zur Synchronisation des lokalen Caches bei Einstellungsänderungen
    document.addEventListener('lea-settings-changed', (e) => {
        if (e.detail) {
            cachedSettings = e.detail;
        }
    });
}

var LEA_CONFIG = window.LEA_CONFIG;

// =========================================================================
// GEMEINSAME HILFSFUNKTIONEN
// =========================================================================

// Basis Wartefunktion
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Wartet auf das Erscheinen eines Elements im DOM. Optional mit Abbruchbedingung (z.B. stopRequested)
async function waitForElementToAppear(selector, timeoutMs = 3000, checkCancel = null) {
    const startTime = Date.now();
    while (!document.querySelector(selector)) {
        if (checkCancel && checkCancel()) throw new Error('STOP');
        if (Date.now() - startTime > timeoutMs) return false;
        await new Promise(r => setTimeout(r, 50));
    }
    return true;
}

// Wartet auf das Verschwinden eines Elements aus dem DOM. Optional mit Abbruchbedingung.
async function waitForElementToDisappear(selector, timeoutMs = 3000, checkCancel = null) {
    const startTime = Date.now();
    while (document.querySelector(selector)) {
        if (checkCancel && checkCancel()) throw new Error('STOP');
        if (Date.now() - startTime > timeoutMs) {
            console.warn(`[LEA Helpers] Timeout: Element ${selector} ist nicht verschwunden.`);
            break;
        }
        await new Promise(r => setTimeout(r, 50));
    }
}

// Simuliert MouseEvents zum Klicken auf ein Element
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

// Wandelt einen Zeitstring (z. B. "1h 15m 30s") in Sekunden um
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

// Liest die benötigte Lieferzeit aus dem DOM
function getDeliveryTimeSeconds() {
    const match = (document.body.textContent || '').match(/Zeit ben[öo]tigt\s+((?:\d+\s*[hms]\s*){1,3})/i);
    if (match && match[1]) {
        return { seconds: parseTimeToSeconds(match[1]), timeString: match[1].trim() };
    }
    return null;
}

// Zeigt eine temporäre Toast-Benachrichtigung an
function showToast(msg, toastId = 'lea-toast', duration = 2000) {
    const existing = document.getElementById(toastId);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = 'lea-toast';
    toast.textContent = msg;

    document.body.appendChild(toast);

    setTimeout(() => {
        const el = document.getElementById(toastId);
        if (el) {
            el.style.opacity = '0';
            setTimeout(() => {
                if (document.getElementById(toastId) === el) el.remove();
            }, 300);
        }
    }, duration);
}

// Formatiert Textmengen (z.B. "1.5K", "3M") in Ganzzahlen
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

// Liest den Zahlenwert aus einem number-flow-vue Element aus
function getNumberFromFlow(element) {
    if (!element) return 0;

    // 1. aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim() !== '') return parseAmount(ariaLabel);

    // 2. Shadow DOM
    const shadowRoot = element.shadowRoot;
    if (shadowRoot) {
        const intDigits = shadowRoot.querySelectorAll('[part~="integer-digit"]');
        let intStr = '';
        intDigits.forEach(d => {
            const m = (d.getAttribute('style') || '').match(/--current:\s*(\d+)/);
            if (m) intStr += m[1];
        });

        if (intStr) {
            const fracDigits = shadowRoot.querySelectorAll('[part~="fraction-digit"]');
            let fracStr = '';
            fracDigits.forEach(d => {
                const m = (d.getAttribute('style') || '').match(/--current:\s*(\d+)/);
                if (m) fracStr += m[1];
            });

            const suffixEl = shadowRoot.querySelector('[part~="suffix"]');
            const suffix = suffixEl ? suffixEl.textContent.trim() : '';

            const numStr = fracStr ? `${intStr}.${fracStr}${suffix}` : `${intStr}${suffix}`;
            return parseAmount(numStr);
        }
    }

    // 3. Vue 3 Fallback
    const vueKey = Object.keys(element).find(k => k.startsWith('__vue'));
    if (vueKey) {
        const vm = element[vueKey];
        const val = vm?.props?.value ?? vm?.setupState?.value ?? vm?.ctx?.value;
        if (val !== undefined && val !== null && !isNaN(Number(val))) {
            return Math.abs(Math.round(Number(val)));
        }
    }

    return 0;
}

// Simuliert die Texteingabe in ein Custom Vue-Eingabefeld (div mit tabindex="0")
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

    [element, document].forEach(t => {
        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        t.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    });
    await wait(30);
}

// Klickt auf den Zurück-Button, um zur vorherigen Ansicht zu gelangen
async function goBack() {
    const backBtn = document.querySelector('.bottom-navigation button[show-divider]') ||
        document.querySelector('.bottom-navigation button:first-child') ||
        document.querySelector('button.variant--neutral img[src*="arrow-back"]')?.closest('button');
    if (backBtn) {
        console.log('[LEA Helpers] Klicke Zurück-Button...');
        simulateClick(backBtn);
        await wait(600);
        return true;
    }
    console.warn('[LEA Helpers] Zurück-Button nicht gefunden!');
    return false;
}

// Navigiert schrittweise zurück zur Gebäudeübersicht, indem wiederholt der Zurück-Button geklickt wird
async function navigateBackToBuildingOverview(maxSteps = 6) {
    console.log('[LEA Helpers] Navigiere zurück zur Gebäudeübersicht...');

    for (let i = 0; i < maxSteps; i++) {
        if (document.querySelector('[data-tutorial-id="filter_by_building_type"]')) {
            console.log('[LEA Helpers] Gebäudeübersicht erreicht.');
            return true;
        }

        const backClicked = await goBack();
        if (!backClicked) {
            console.warn('[LEA Helpers] Kein Zurück-Button gefunden, Abbruch der Navigation.');
            return false;
        }
    }

    const arrived = !!document.querySelector('[data-tutorial-id="filter_by_building_type"]');
    if (!arrived) {
        console.warn('[LEA Helpers] Gebäudeübersicht nach maxSteps nicht erreicht!');
    }
    return arrived;
}

// Startet eine Suche nach dem angegebenen Begriff über das Suchfeld im Spiel
async function triggerSearch(term) {
    console.log(`[LEA Helpers] Starte Suche nach: ${term}`);

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

    console.warn('[LEA Helpers] Suchfeld konnte nicht geöffnet werden.');
    return false;
}

// Setzt die Suche zurück, indem der Löschen-Button (rotes Kreuz) angeklickt wird
async function clearSearch() {
    console.log('[LEA Helpers] Setze Suchfilter zurück...');
    
    await navigateBackToBuildingOverview();
    await wait(200);

    const searchBtn = document.querySelector('[data-tutorial-id="filter_by_search"]');
    if (searchBtn) {
        const isActive = searchBtn.getAttribute('active') === 'true';
        if (isActive) {
            simulateClick(searchBtn);
            console.log('[LEA Helpers] Suchfilter erfolgreich zurückgesetzt.');
            await wait(400); // Warten, bis die Liste aktualisiert wird
            return true;
        } else {
            console.log('[LEA Helpers] Keine aktive Suche zum Zurücksetzen gefunden.');
        }
    } else {
        console.warn('[LEA Helpers] Suchfilter-Löschen-Button nicht gefunden.');
    }
    return false;
}

// Liest alle sichtbaren Gebäudekarten aus dem Virtual-Scroll-DOM aus, die das angegebene Präfix im Namen tragen
function getIndexedCards(prefix) {
    if (!prefix) return [];
    return Array.from(document.querySelectorAll('[data-index]'))
        .map(el => ({
            index: parseInt(el.getAttribute('data-index'), 10),
            card: el.querySelector('[class*="building-card"]')
        }))
        .filter(item =>
            !isNaN(item.index) &&
            item.card !== null &&
            item.card.textContent.toUpperCase().includes(prefix.toUpperCase())
        )
        .sort((a, b) => a.index - b.index);
}

// Wartet darauf, dass eine Gebäudekarte mit einem höheren Index als dem zuletzt verarbeiteten sichtbar wird
async function waitForNextCard(lastProcessedIndex, prefix) {
    let indexedCards = [];
    const startLoadTime = Date.now();
    while (Date.now() - startLoadTime < 4000) {
        indexedCards = getIndexedCards(prefix);
        const hasNext = indexedCards.some(item => item.index > lastProcessedIndex);
        if (hasNext) break;
        await wait(100);
    }
    return indexedCards.find(item => item.index > lastProcessedIndex) || null;
}

// Ermittelt den Namen des Gebäudes aus einer Gebäudekarte (Kachel)
function getBuildingName(card, prefix) {
    if (!card) return 'Unbekannt';
    
    const elements = Array.from(card.querySelectorAll('div, span, p'));
    for (const el of elements) {
        const text = el.textContent.trim();
        if (text.toUpperCase().includes(prefix.toUpperCase()) && el.children.length === 0) {
            return text.split('\n')[0].trim();
        }
    }
    
    for (const el of elements) {
        const text = el.textContent.trim();
        if (text.toUpperCase().includes(prefix.toUpperCase())) {
            return text.split('\n')[0].trim();
        }
    }
    
    return card.textContent.trim().split('\n')[0].trim().substring(0, 35);
}

// Schaltet einen Suchfilter um: Wenn das Suchfeld bereits genau das Präfix enthält,
// wird die Suche gelöscht. Andernfalls wird die Suche mit dem Präfix gestartet.
async function toggleSearchFilter(prefix) {
    let searchInput = document.querySelector('input[placeholder*="Suche"], input[placeholder*="Name"], .bb-filter-and-sort-bar input');

    // Falls die Suche nicht offen ist, öffnen wir sie zuerst
    if (!searchInput) {
        const searchBtn = document.querySelector('[data-tutorial-id="filter_by_search"]');
        if (searchBtn) {
            simulateClick(searchBtn);
            await waitForElementToAppear('input', 1500);
            searchInput = document.querySelector('input');
        }
    }

    if (searchInput) {
        const currentVal = searchInput.value.trim();

        if (currentVal.toUpperCase() === prefix.toUpperCase()) {
            // Wenn die Suche aktiv ist, löschen wir sie
            // Wir suchen nach dem 'x'-Lösch-Button im/am Suchfeld
            const closeBtn = searchInput.parentElement?.querySelector('button, img[src*="close"], img[src*="cancel"], .icon-close');
            if (closeBtn) {
                simulateClick(closeBtn);
            } else {
                // Fallback: Wert leeren, Events auslösen und Suchfeld durch Klick schließen
                searchInput.focus();
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                searchInput.dispatchEvent(new Event('change', { bubbles: true }));
                searchInput.blur();

                const searchBtn = document.querySelector('[data-tutorial-id="filter_by_search"]');
                if (searchBtn) simulateClick(searchBtn);
            }
        } else {
            // Wenn die Suche nicht aktiv ist, setzen wir das Präfix
            searchInput.focus();
            searchInput.value = prefix;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            searchInput.blur();
        }
        await wait(400); // Warten auf Liste-Update
    }
}

