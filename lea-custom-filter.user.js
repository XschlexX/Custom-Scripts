// ==UserScript==
// @name         LEA Custom Filter
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.1.3
// @match        https://game.logistics-empire.com/*
// @description  Fügt einen Filter in der Gebäudeübersicht hinzu, um nur Gebäude mit gestoppter Produktionslinie anzuzeigen.
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js?v=1.0.13
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-custom-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-custom-filter.user.js
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // SELEKTOREN & KONSTANTEN
    // -----------------------------------------------------------------------
        const FILTER_BAR_SELECTOR = '.bb-filter-and-sort-bar';
    const INJECT_BTN_ID = 'lea-custom-stop-filter-btn';
    const AF_BTN_ID = 'lea-filter-af-btn';
    const LS_BTN_ID = 'lea-filter-ls-btn';
    const NEXT_BTN_ID = 'lea-custom-next-btn';
    const BUILDING_CARD_SELECTOR = '.building-card';
    const STOP_ICON_SELECTOR = 'img[src*="icon_blocked"]';

    let isDropdownOpen = false;
    let activeFilters = {
        paused: false,
        fusion: false
    };

    // Auto-Scroll Zustand
    let scrollRafId = null;
    let lastMatchScrollTop = null; // scrollTop-Wert, bei dem der letzte Treffer oben lag
    let lastMatchHeight = 200;  // Höhe des letzten Treffer-Gebäudes (Schätzwert als Fallback)

    // -----------------------------------------------------------------------
    // GLOBALER KLICK-LISTENER (für Dropdown)
    // -----------------------------------------------------------------------
    document.addEventListener('click', () => {
        if (isDropdownOpen) {
            isDropdownOpen = false;
            const container = document.getElementById(INJECT_BTN_ID);
            if (container) {
                container.remove();
                injectFilterButtons();
            }
        }
    });

    // -----------------------------------------------------------------------
    // HILFSFUNKTIONEN
    // -----------------------------------------------------------------------
    function isBuildingOverviewOpen() {
        // Prüfen, ob wir die Filter-Leiste auf dem Bildschirm haben.
        // Das bedeutet, wir sind in einer Listen-Ansicht (Gebäude, Anfragen, etc.).
        // Wir aktivieren den Filter nur, wenn wir auch Gebäude-Karten finden.
        return !!document.querySelector(FILTER_BAR_SELECTOR);
    }

    // -----------------------------------------------------------------------
    // FILTER-LOGIK
    // -----------------------------------------------------------------------

    /** Prüft, ob ein einzelnes Gebäude die aktuell aktiven Filter erfüllt. */
    function matchesFilter(building) {
        if (activeFilters.paused && building.querySelector(STOP_ICON_SELECTOR)) {
            return true;
        }
        if (activeFilters.fusion) {
            const labels = building.querySelectorAll('.bb-label-container');
            for (const label of labels) {
                if (label.textContent.includes('Fusion im Gange')) return true;
            }
        }
        return false;
    }

    function applyFilter() {
        if (!isBuildingOverviewOpen()) return;

        const buildings = Array.from(document.querySelectorAll(BUILDING_CARD_SELECTOR));
        const activeCount = Object.values(activeFilters).filter(v => v).length;

        for (let i = 0; i < buildings.length; i++) {
            const building = buildings[i];

            building.classList.remove('lea-building-active-match', 'lea-building-dimmed');

            if (activeCount > 0) {
                if (matchesFilter(building)) {
                    building.classList.add('lea-building-active-match');
                } else {
                    building.classList.add('lea-building-dimmed');
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // AUTO-SCROLL: Scrollt zur ersten Übereinstimmung
    // -----------------------------------------------------------------------

    /** Findet den scrollbaren Eltern-Container der Gebäudeliste. */
    function getScrollContainer() {
        const card = document.querySelector(BUILDING_CARD_SELECTOR);
        if (!card) return null;
        let el = card.parentElement;
        while (el && el !== document.body) {
            if (el.scrollHeight > el.clientHeight + 5) return el;
            el = el.parentElement;
        }
        return null;
    }

    /** Stoppt einen laufenden Auto-Scroll und entfernt den Weiter-Button. */
    function stopAutoScroll() {
        if (scrollRafId !== null) {
            cancelAnimationFrame(scrollRafId);
            scrollRafId = null;
        }
        const nextBtn = document.getElementById(NEXT_BTN_ID);
        if (nextBtn) nextBtn.remove();
        lastMatchScrollTop = null;
    }

    function injectNextButton() {
        // Alten Button entfernen (verhindert Duplikate)
        const old = document.getElementById(NEXT_BTN_ID);
        if (old) old.remove();

        const cont = getScrollContainer();
        if (!cont) return;
        const parent = cont.parentElement;
        if (!parent) return;

        // Sicherstellen, dass das Elternelement als Positionierungs-Anker dient
        const computedStyle = window.getComputedStyle(parent);
        if (computedStyle.position === 'static') {
            parent.classList.add('lea-relative-parent');
        }

        const btn = document.createElement('button');
        btn.id = NEXT_BTN_ID;
        btn.type = 'button';
        btn.className = 'lea-next-match-btn';
        btn.title = 'Next Match';
        btn.textContent = 'Next';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            scrollToNextMatch();
        });

        parent.appendChild(btn);
    }

    /** Startet die Suche ab direkt unterhalb des letzten Treffers. */
    function scrollToNextMatch() {
        if (lastMatchScrollTop === null) return;
        startAutoScroll(lastMatchScrollTop + lastMatchHeight + 2);
    }

    /**
     * Scrollt die Gebäudeliste schrittweise nach unten, bis ein passendes
     * Gebäude im DOM erscheint (Virtual Scrolling), und springt dann direkt hin.
     *
     * @param {number|null} fromScrollTop  Wenn angegeben, startet die Suche ab dieser
     *                                     scrollTop-Position statt von Anfang (für "Weiter").
     */
    function startAutoScroll(fromScrollTop = null) {
        stopAutoScroll();
        if (!Object.values(activeFilters).some(v => v)) return;

        const cont0 = getScrollContainer();
        if (!cont0) return;

        if (fromScrollTop !== null) {
            // Suche ab einer bestimmten Position ("Weiter")
            cont0.scrollTop = fromScrollTop;
        } else {
            // Frische Suche: von oben beginnen, Zustand zurücksetzen
            lastMatchScrollTop = null;
            cont0.scrollTop = 0;
        }

        let lastScrollTopVal = -1;
        let stepsWithoutChange = 0;
        const SCROLL_STEP = 300; // px pro Schritt
        const MAX_STALL = 5;   // Frames ohne Fortschritt -> Abbruch

        function step() {
            const cont = getScrollContainer();
            if (!cont) return; // Container verschwunden (Menüwechsel)

            const contRect = cont.getBoundingClientRect();

            // Erstes passendes Gebäude suchen, dessen Oberkante
            // sich am oder unterhalb des Container-Oberrands befindet
            // (verhindert, dass ein bereits besuchter Treffer erneut gefunden wird)
            let match = null;
            for (const card of document.querySelectorAll(BUILDING_CARD_SELECTOR)) {
                if (!matchesFilter(card)) continue;
                if (card.getBoundingClientRect().top >= contRect.top - 5) {
                    match = card;
                    break;
                }
            }

            if (match) {
                // Treffer bündig am oberen Container-Rand positionieren
                const matchTop = match.getBoundingClientRect().top;
                const targetScrollTop = cont.scrollTop + (matchTop - contRect.top);
                cont.scrollTo({ top: targetScrollTop, behavior: 'smooth' });

                // Position und Höhe für "Weiter" merken
                lastMatchScrollTop = targetScrollTop;
                lastMatchHeight = match.offsetHeight || 200;

                scrollRafId = null;
                injectNextButton(); // "▼ Weiter"-Button einblenden
                return;
            }

            // Am Ende der Liste?
            const atBottom = cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 10;
            if (atBottom) {
                scrollRafId = null;
                return;
            }

            // Stall-Detektion
            if (cont.scrollTop === lastScrollTopVal) {
                stepsWithoutChange++;
                if (stepsWithoutChange >= MAX_STALL) { scrollRafId = null; return; }
            } else {
                stepsWithoutChange = 0;
            }

            lastScrollTopVal = cont.scrollTop;
            cont.scrollTop += SCROLL_STEP;

            // Kurze Pause, damit das Spiel neue Gebäude rendern kann
            scrollRafId = setTimeout(() => {
                scrollRafId = requestAnimationFrame(step);
            }, 80);
        }

        // Kleinen Moment warten, bis das Spiel nach dem Scroll-Reset rendert
        scrollRafId = setTimeout(() => {
            scrollRafId = requestAnimationFrame(step);
        }, 150);
    }

    // -----------------------------------------------------------------------
    // UI: Filter-Button einfügen
    // -----------------------------------------------------------------------
    // -----------------------------------------------------------------------
    // UI: Filter-Buttons erstellen und verwalten
    // -----------------------------------------------------------------------

    function createSearchFilterButton(id, prefix) {
        const btn = document.createElement('button');
        btn.id = id;
        btn.type = 'button';
        
        // Bereinigtes Label: z. B. "(AF)" -> "AF"
        const label = prefix.replace(/[()]/g, '');
        btn.title = `Suche nach ${prefix} filtern/zurücksetzen`;
        btn.className = 'bb-base-button size--md shape--square theme--light lea-injected-btn';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.textContent = label;
        btn.appendChild(inner);

        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (typeof toggleSearchFilter === 'function') {
                await toggleSearchFilter(prefix);
                updateFilterButtonsState();
            } else {
                console.error('[LEA Custom Filter] toggleSearchFilter nicht definiert!');
            }
        });

        return btn;
    }

    function updateFilterButtonsState() {
        const searchInput = document.querySelector('input[placeholder*="Suche"], input[placeholder*="Name"], .bb-filter-and-sort-bar input');
        const currentSearchVal = searchInput ? searchInput.value.trim() : '';

        // Präfixe aus LEA_CONFIG laden
        const afPrefix = (window.LEA_CONFIG && window.LEA_CONFIG.settings && window.LEA_CONFIG.settings.buildingPrefix) || '(AF)';
        const lsPrefix = (window.LEA_CONFIG && window.LEA_CONFIG.settings && window.LEA_CONFIG.settings.storagePrefix) || '(LS)';

        // 1. Custom Button Zustand
        const customBtn = document.querySelector(`#${INJECT_BTN_ID} button`);
        if (customBtn) {
            const hasAnyFilterActive = Object.values(activeFilters).some(v => v);
            const inner = customBtn.querySelector('.lea-injected-btn-inner');
            
            if (hasAnyFilterActive) {
                customBtn.classList.remove('variant--neutral');
                customBtn.classList.add('variant--normal', 'lea-filter-btn-active');
                if (inner) inner.classList.add('lea-filter-btn-inner-active');
            } else {
                customBtn.classList.remove('variant--normal', 'lea-filter-btn-active');
                customBtn.classList.add('variant--neutral');
                if (inner) inner.classList.remove('lea-filter-btn-inner-active');
            }
        }

        // 2. AF Button Zustand
        const afBtn = document.getElementById(AF_BTN_ID);
        if (afBtn) {
            if (currentSearchVal.toUpperCase() === afPrefix.toUpperCase()) {
                afBtn.classList.remove('variant--neutral');
                afBtn.classList.add('variant--normal');
            } else {
                afBtn.classList.remove('variant--normal');
                afBtn.classList.add('variant--neutral');
            }
        }

        // 3. LS Button Zustand
        const lsBtn = document.getElementById(LS_BTN_ID);
        if (lsBtn) {
            if (currentSearchVal.toUpperCase() === lsPrefix.toUpperCase()) {
                lsBtn.classList.remove('variant--neutral');
                lsBtn.classList.add('variant--normal');
            } else {
                lsBtn.classList.remove('variant--normal');
                lsBtn.classList.add('variant--neutral');
            }
        }
    }

    function injectFilterButtons() {
        if (!isBuildingOverviewOpen()) {
            const existing = document.getElementById(INJECT_BTN_ID);
            if (existing) existing.remove();
            const afBtn = document.getElementById(AF_BTN_ID);
            if (afBtn) afBtn.remove();
            const lsBtn = document.getElementById(LS_BTN_ID);
            if (lsBtn) lsBtn.remove();
            const nextBtn = document.getElementById(NEXT_BTN_ID);
            if (nextBtn) nextBtn.remove();
            return;
        }

        const buildingTypeDiv = document.querySelector('[data-tutorial-id="filter_by_building_type"]');
        if (!buildingTypeDiv) return;

        // Container zu Flexbox machen, damit die Buttons nebeneinander liegen
        buildingTypeDiv.classList.add('lea-flex-row');

        // --- 1. Custom Button & Dropdown ---
        if (!document.getElementById(INJECT_BTN_ID)) {
            // Wrapper-Container für Button und Dropdown
            const container = document.createElement('div');
            container.id = INJECT_BTN_ID;
            container.className = 'lea-filter-container';

            // Haupt-Button-Element erstellen
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.title = 'Custom Filter Menü öffnen';
            btn.className = 'bb-base-button size--md theme--light lea-filter-btn';

            const inner = document.createElement('div');
            inner.className = 'relative flex size-full items-center justify-center gap-1 lea-injected-btn-inner';
            inner.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
            `;

            // Pfeil-Icon hinzufügen für Dropdown-Indikator
            const arrow = document.createElement('span');
            arrow.textContent = ' ▼';
            arrow.className = 'lea-dropdown-arrow';
            inner.appendChild(arrow);

            btn.appendChild(inner);
            container.appendChild(btn);

            // Dropdown-Menü erstellen (mit Game-Styling)
            const dropdown = document.createElement('div');
            dropdown.style.display = isDropdownOpen ? 'block' : 'none';
            dropdown.className = 'lea-filter-dropdown p-popover p-component bb-filter-popover rounded-lg border-1 border-content-box-outline bg-container-bg-b bg-(image:--background-gradient-card-info) shadow-(--shadow-generic)';

            dropdown.addEventListener('click', (e) => {
                e.stopPropagation(); // Verhindert Schließen beim Klick ins Menü
            });

            const dropdownContent = document.createElement('div');
            dropdownContent.className = 'p-popover-content flex flex-col gap-md p-md lea-filter-dropdown-content';

            // --- Hilfsfunktion für Filter-Items ---
            function createFilterItem(id, labelText, emojiIcon, isActive, onClick) {
                const item = document.createElement('div');
                item.className = 'flex cursor-pointer items-center gap-1.5 select-none';

                const toggleBgClass = isActive ? 'bg-toggle-bg-on border-toggle-outline-on' : 'bg-toggle-bg-off border-toggle-outline-off';
                const toggleDotClass = isActive ? 'bg-toggle-on translate-x-[24px]' : 'bg-toggle-off translate-x-0';

                item.innerHTML = `
                    <div class="size-9 shrink-0 flex items-center justify-center text-xl">${emojiIcon}</div>
                    <span class="text-p1-500 flex-1">${labelText}</span>
                    <div class="bg-content-box-bg relative h-[24px] w-[48px] rounded-full border transition duration-150 ease-in-out ${toggleBgClass}">
                        <div class="absolute top-[2px] left-[2px] aspect-square h-[18px] rounded-full transition duration-150 ease-in-out ${toggleDotClass}"></div>
                    </div>
                `;

                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    onClick();
                });

                return item;
            }

            // --- Hilfsfunktion für Divider ---
            function createDivider() {
                const div = document.createElement('div');
                div.className = 'w-full';
                div.innerHTML = `
                    <div class="h-[1px] w-full bg-linear-to-r from-transparent via-white to-transparent opacity-30"></div>
                    <div class="h-[1px] w-full bg-linear-to-r from-transparent via-black to-transparent opacity-50"></div>
                `;
                return div;
            }

            // 1. Option: Produktion pausiert
            const itemStop = createFilterItem('stop', 'Produktion pausiert', '🛑', activeFilters.paused, () => {
                activeFilters.paused = !activeFilters.paused;
                applyFilter();
                if (activeFilters.paused) startAutoScroll(); else stopAutoScroll();
                isDropdownOpen = false;
                container.remove();
                injectFilterButtons();
            });
            dropdownContent.appendChild(itemStop);

            // Trennlinie
            dropdownContent.appendChild(createDivider());

            // 2. Option: Fusion im Gange
            const itemFusion = createFilterItem('fusion', 'Fusion im Gange', '🔄', activeFilters.fusion, () => {
                activeFilters.fusion = !activeFilters.fusion;
                applyFilter();
                if (activeFilters.fusion) startAutoScroll(); else stopAutoScroll();
                isDropdownOpen = false;
                container.remove();
                injectFilterButtons();
            });
            dropdownContent.appendChild(itemFusion);

            dropdown.appendChild(dropdownContent);
            container.appendChild(dropdown);

            // Klick-Logik für Hauptbutton (Menü auf/zu)
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                isDropdownOpen = !isDropdownOpen;
                // Container neu laden für frisches Styling
                container.remove();
                injectFilterButtons();
            });

            // In das Div neben den anderen Button einfügen
            buildingTypeDiv.appendChild(container);
        }

        // --- 2. AF Button ---
        if (!document.getElementById(AF_BTN_ID)) {
            const afPrefix = (window.LEA_CONFIG && window.LEA_CONFIG.settings && window.LEA_CONFIG.settings.buildingPrefix) || '(AF)';
            const afBtn = createSearchFilterButton(AF_BTN_ID, afPrefix);
            buildingTypeDiv.appendChild(afBtn);
        }

        // --- 3. LS Button ---
        if (!document.getElementById(LS_BTN_ID)) {
            const lsPrefix = (window.LEA_CONFIG && window.LEA_CONFIG.settings && window.LEA_CONFIG.settings.storagePrefix) || '(LS)';
            const lsBtn = createSearchFilterButton(LS_BTN_ID, lsPrefix);
            buildingTypeDiv.appendChild(lsBtn);
        }

        // Zustände aktualisieren
        updateFilterButtonsState();
    }

    // -----------------------------------------------------------------------
    // INIT & OBSERVER
    // -----------------------------------------------------------------------
    function init() {
        console.log('[LEA Custom Filter] Initialisiert v1.1.3 (Filter-Buttons)');

        injectFilterButtons();
        applyFilter();

        // MutationObserver fängt an, wenn sich das DOM ändert (z.B. durch Virtual Scrolling oder Menüwechsel)
        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    injectFilterButtons();
                    // Wenn ein Filter aktiv ist, müssen wir ihn auf neu aufgetauchte Gebäude anwenden
                    if (Object.values(activeFilters).some(v => v)) {
                        applyFilter();
                    }
                    isHandlingMutations = false;
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        // Event-Listener für live Einstellungsänderungen
        document.addEventListener('lea-settings-changed', () => {
            const afBtn = document.getElementById(AF_BTN_ID);
            if (afBtn) afBtn.remove();
            const lsBtn = document.getElementById(LS_BTN_ID);
            if (lsBtn) lsBtn.remove();
            injectFilterButtons();
        });
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
