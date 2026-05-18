// ==UserScript==
// @name         LEA Auto Upgrade
// @namespace    le-tools
// @version      1.3.1
// @match        https://game.logistics-empire.com/*
// @description  Startet einen automatischen Durchlauf über alle Gebäude mit verfügbaren Upgrades und schließt diese ab.
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-upgrade.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-auto-upgrade.user.js
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // SELEKTOREN & KONSTANTEN
    // -----------------------------------------------------------------------
    const AVAILABLE_STATUS_SRC = 'improvement_status_available_mini'; // Gelbes Upgrade-verfuegbar-Icon
    const ARROW_BTN_SRC = 'to_quest_objective';                // Blauer Pfeil rechts am Gebaeude
    const FILTER_BAR_SELECTOR = '.bb-filter-and-sort-bar';
    const INJECT_BTN_ID = 'lea-upgrade-scan-btn';

    // UI Elemente im Gebäude
    const SETTINGS_BTN_SELECTOR = 'button[data-tutorial-id="factory-line-settings-button"]';
    const IMPROVEMENT_ARROW_SRC = 'improvement_arrow';
    const BACK_BTN_SELECTOR = '.bottom-navigation button[show-divider]';

    // Dialog
    const DIALOG_SELECTOR = '.bb-dialog';
    const TITLE_SELECTOR = '.text-h1';
    const BUCKS_SRC_PREFIX = 'https://game.logistics-empire.com/assets/cur_bucks-';

    // Status
    let isUpgrading = false;

    // -----------------------------------------------------------------------
    // HILFSFUNKTIONEN (Warten & UI-Prüfungen)
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
                console.warn(`[LEA Upgrade] Timeout: Element ${selector} ist nicht verschwunden.`);
                break;
            }
            await new Promise(r => setTimeout(r, 50));
        }
    }

    function isUpgradeOverviewOpen() {
        return !!document.querySelector('a[href="#/buildings/upgrades"].router-link-exact-active');
    }

    function showToast(msg) {
        const existing = document.getElementById('lea-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'lea-toast';
        toast.className = 'lea-toast';
        toast.textContent = msg;

        document.body.appendChild(toast);

        setTimeout(() => {
            const el = document.getElementById('lea-toast');
            if (el) {
                el.style.opacity = '0';
                setTimeout(() => {
                    if (document.getElementById('lea-toast') === el) el.remove();
                }, 300);
            }
        }, 2000);
    }

    // -----------------------------------------------------------------------
    // SUCH-FUNKTIONEN FÜR UPGRADES
    // -----------------------------------------------------------------------

    function findNextAvailableBuildingArrow() {
        const btnContainers = document.querySelectorAll('[data-tutorial-id="building-list-item-buttons"]');
        for (const container of btnContainers) {
            const card = container.closest('[class*="building-card"]');
            if (!card) continue;

            const hasAvailable = !!card.querySelector(`img[src*="${AVAILABLE_STATUS_SRC}"]`);
            if (!hasAvailable) continue;

            const arrowBtn = container.querySelector(`img[src*="${ARROW_BTN_SRC}"]`)?.closest('button');
            if (arrowBtn && arrowBtn.offsetParent !== null) {
                return arrowBtn;
            }
        }
        return null;
    }

    function findExpandButton() {
        const expandBtns = Array.from(document.querySelectorAll('button.variant--normal')).filter(btn => {
            const txt = btn.querySelector('.text-font-dark');
            return txt && txt.textContent.includes('Ausbauen') && btn.getAttribute('disabled') === null;
        });
        if (expandBtns.length > 0) return expandBtns[0];

        const storageImgs = document.querySelectorAll('button:not([disabled]) img[src*="icon_improve_storage"]');
        if (storageImgs.length > 0) return storageImgs[0].closest('button');

        const unlockBtns = document.querySelectorAll('div[data-tutorial-id="factory-line-unlock"] button.variant--normal:not([disabled])');
        if (unlockBtns.length > 0) return unlockBtns[0];

        return null;
    }

    function findSettingsGearWithUpgrade() {
        const settingsBtns = document.querySelectorAll(SETTINGS_BTN_SELECTOR);
        for (const btn of settingsBtns) {
            if (btn.querySelector(`img[src*="${IMPROVEMENT_ARROW_SRC}"]`) && btn.getBoundingClientRect().width > 0) {
                return btn;
            }
        }
        return null;
    }

    function findImprovementButton() {
        const imgs = document.querySelectorAll('.improvements-entry button:not([disabled]) img[src*="improvement_arrow"]');
        for (const img of imgs) {
            const btn = img.closest('button');
            if (btn && btn.getBoundingClientRect().width > 0) return btn;
        }
        return null;
    }

    function findTabWithUpgrade() {
        const navTabsWithUpgrade = document.querySelectorAll('.bottom-navigation a button img[src*="improvement_arrow"]');
        for (const img of navTabsWithUpgrade) {
            const tabBtn = img.closest('button');
            if (tabBtn && tabBtn.getAttribute('active') !== 'true') return tabBtn;
        }
        return null;
    }

    async function handleUpgradeDialog() {
        // Warte auf Dialog (max 1500ms)
        const dialogAppeared = await waitForElementToAppear(DIALOG_SELECTOR, 1500);
        if (!dialogAppeared) return;

        const dialog = document.querySelector(DIALOG_SELECTOR);
        if (!dialog) return;

        const titleEl = dialog.querySelector(TITLE_SELECTOR);
        const titleText = (titleEl && titleEl.textContent || '').trim();
        if (!/upgrade/i.test(titleText)) return;

        let targetBtn = null;
        dialog.querySelectorAll('button img').forEach(img => {
            const src = img.getAttribute('src') || img.src || '';
            if (src.startsWith(BUCKS_SRC_PREFIX) && !targetBtn) {
                targetBtn = img.closest('button');
            }
        });

        if (targetBtn && !targetBtn.hasAttribute('disabled')) {
            console.log('[LEA Upgrade] Klicke Dialog-Bestätigung...');
            targetBtn.click();
            await waitForElementToDisappear(DIALOG_SELECTOR, 3000);
        } else {
            // Fallback: Wenn wir es nicht klicken können (zu wenig Geld), Dialog schließen
            console.warn('[LEA Upgrade] Dialog kann nicht bestätigt werden. Schließe ihn...');
            const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(b =>
                (b.textContent.includes('Abbrechen') || b.textContent.includes('Schließen')) && !b.hasAttribute('disabled')
            );
            if (cancelBtn) cancelBtn.click();
            await waitForElementToDisappear(DIALOG_SELECTOR, 3000);
        }
    }

    // -----------------------------------------------------------------------
    // HAUPT-UPGRADE LOGIK (ASYNC)
    // -----------------------------------------------------------------------

    async function executeAutoUpgrade() {
        if (isUpgrading) {
            showToast('Upgrade läuft bereits...');
            return;
        }
        isUpgrading = true;

        try {
            console.log('[LEA Upgrade] Starte Auto-Upgrade Ablauf...');

            let hasMoreBuildings = true;

            while (hasMoreBuildings) {
                // Schritt 1: Liste nach oben scrollen, damit Virtual Scrolling alle Elemente lädt
                const anchorCard = document.querySelector('[class*="building-card"]');
                if (anchorCard) {
                    let scrollContainer = anchorCard.parentElement;
                    while (scrollContainer && scrollContainer !== document.body) {
                        const style = window.getComputedStyle(scrollContainer);
                        if (style.overflowY === 'auto' || style.overflowY === 'scroll' || scrollContainer.classList.contains('scroll')) {
                            scrollContainer.scrollTop = 0;
                            break;
                        }
                        scrollContainer = scrollContainer.parentElement;
                    }
                    await new Promise(r => setTimeout(r, 300)); // Kurz warten auf DOM Rendering
                }

                // Schritt 2: Nächstes Gebäude suchen und reingehen
                const arrowBtn = findNextAvailableBuildingArrow();
                if (!arrowBtn) {
                    showToast('Alle Upgrades abgeschlossen!');
                    hasMoreBuildings = false;
                    break;
                }

                console.log('[LEA Upgrade] Gebäude mit Upgrade gefunden, betrete Gebäude...');
                arrowBtn.click();

                // Warte bis wir aus der Übersicht raus sind (Gebäude lädt)
                const openStartTime = Date.now();
                while (isUpgradeOverviewOpen()) {
                    if (Date.now() - openStartTime > 3000) {
                        console.error('[LEA Upgrade] Gebäude hat sich nicht geöffnet.');
                        break;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
                await new Promise(r => setTimeout(r, 500)); // UI kurz setzen lassen

                // Schritt 3: Alle Upgrades in diesem Gebäude abarbeiten
                let hasMoreUpgrades = true;
                let emergencyExitCounter = 0;

                while (hasMoreUpgrades) {
                    hasMoreUpgrades = false;
                    emergencyExitCounter++;
                    if (emergencyExitCounter > 50) {
                        console.error('[LEA Upgrade] Endlosschleife entdeckt! Breche ab.');
                        break;
                    }

                    // 3.1 Direkte Upgrades prüfen (Ausbauen, Lager erweitern, Linie freischalten)
                    const expandBtn = findExpandButton();
                    if (expandBtn) {
                        console.log('[LEA Upgrade] Ausbauen/Lager/Unlock-Button gefunden, klicke...');
                        expandBtn.click();
                        await handleUpgradeDialog();
                        hasMoreUpgrades = true;
                        await new Promise(r => setTimeout(r, 300)); // UI setzen lassen
                        continue; // Schleife von vorne starten
                    }

                    // 3.2 Produktionslinien prüfen (Zahnrad mit grünem Pfeil)
                    const settingsBtn = findSettingsGearWithUpgrade();
                    if (settingsBtn) {
                        console.log('[LEA Upgrade] Zahnrad mit Upgrade-Pfeil gefunden, betrete Linie...');
                        settingsBtn.click();

                        // Warte bis Linieneinstellungen offen sind
                        await waitForElementToAppear('.improvements-entry', 2000);
                        await new Promise(r => setTimeout(r, 300));

                        // Alle Verbesserungen innerhalb dieser Linie abarbeiten
                        let hasMoreLineUpgrades = true;
                        let lineEmergencyCounter = 0;
                        while (hasMoreLineUpgrades) {
                            lineEmergencyCounter++;
                            if (lineEmergencyCounter > 20) break;

                            const improvementBtn = findImprovementButton();
                            if (improvementBtn) {
                                console.log('[LEA Upgrade] Gelber Verbesserungs-Button gefunden, klicke...');
                                improvementBtn.click();
                                await handleUpgradeDialog();
                                await new Promise(r => setTimeout(r, 300));
                            } else {
                                hasMoreLineUpgrades = false;
                            }
                        }

                        // Fertig mit dieser Linie -> Gehe zurück in die Gebäude-Übersicht
                        const backBtn = document.querySelector(BACK_BTN_SELECTOR);
                        if (backBtn) {
                            console.log('[LEA Upgrade] Verlasse Linieneinstellungen...');
                            backBtn.click();
                            await waitForElementToDisappear('.improvements-entry', 2000);
                            await new Promise(r => setTimeout(r, 500));
                        }

                        hasMoreUpgrades = true;
                        continue; // Schleife von vorne starten
                    }

                    // 3.3 Andere Reiter prüfen (Lager, Fahrzeuge) falls es dort ein Upgrade gibt
                    const otherTab = findTabWithUpgrade();
                    if (otherTab) {
                        console.log('[LEA Upgrade] Upgrade in anderem Reiter gefunden, wechsle Ansicht...');
                        otherTab.click();
                        await new Promise(r => setTimeout(r, 600)); // Warte auf Tab-Wechsel
                        hasMoreUpgrades = true;
                        continue;
                    }
                }

                // Schritt 4: Gebäude komplett fertig -> Zurück zur Upgrade-Liste
                console.log('[LEA Upgrade] Kein weiteres Upgrade im Gebäude, klicke Zurück zur Liste...');
                const backBtn = document.querySelector(BACK_BTN_SELECTOR);
                if (backBtn) {
                    backBtn.click();
                    
                    // Wir warten darauf, dass die Upgrade-Übersicht wieder aktiv ist
                    const backStartTime = Date.now();
                    while (!isUpgradeOverviewOpen()) {
                        if (Date.now() - backStartTime > 3000) break;
                        await new Promise(r => setTimeout(r, 50));
                    }
                    await new Promise(r => setTimeout(r, 500)); // Kurz warten bis Liste gerendert ist
                }
            }

        } catch (e) {
            console.error('[LEA Upgrade] Fehler im Ablauf:', e);
        } finally {
            isUpgrading = false;
        }
    }

    // -----------------------------------------------------------------------
    // UI: Scan-Button einfügen
    // -----------------------------------------------------------------------
    function injectScanButton() {
        if (!isUpgradeOverviewOpen()) {
            const existing = document.getElementById(INJECT_BTN_ID);
            if (existing) existing.remove();
            return;
        }
        if (document.getElementById(INJECT_BTN_ID)) return;

        const filterBar = document.querySelector(FILTER_BAR_SELECTOR);
        if (!filterBar) return;

        const toolbar = filterBar.querySelector('.flex.items-center.justify-between');
        if (!toolbar) return;

        const searchBtn = toolbar.querySelector('[data-tutorial-id="filter_by_search"]');
        if (!searchBtn) return;

        const searchContainer = searchBtn.closest('.relative');
        if (!searchContainer) return;

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md theme--light lea-injected-btn';
        btn.title = 'Nächstes verfügbares Upgrade anklicken';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.textContent = 'Auto\nUpgrade';
        btn.appendChild(inner);

        // Klick auf den Button startet den Async-Ablauf!
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            executeAutoUpgrade();
        });

        searchContainer.parentNode.insertBefore(btn, searchContainer);
    }

    // -----------------------------------------------------------------------
    // INIT
    // -----------------------------------------------------------------------
    function init() {
        console.log('[LEA Upgrade Search and Accept] Initialisiert v1.3.1 (Voll-Automatikmodus)');

        injectScanButton();

        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    // Der Observer ist nur noch dafür da, den Button am Leben zu erhalten
                    injectScanButton();
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
