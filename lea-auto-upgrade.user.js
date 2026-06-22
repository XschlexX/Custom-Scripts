// ==UserScript==
// @name         LEA Auto Upgrade
// @namespace    lea-tools
// @author       DonSanchos
// @version      1.1.8
// @match        https://game.logistics-empire.com/*
// @description  Startet einen automatischen Durchlauf über alle Gebäude mit verfügbaren Upgrades und schließt diese ab.
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-shared-helpers.js?v=1.0.10
// @updateURL    https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-upgrade.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Custom-Scripts/main/lea-auto-upgrade.user.js
// ==/UserScript==

(function () {
    'use strict';

    // -----------------------------------------------------------------------
    // SELEKTOREN & KONSTANTEN
    // -----------------------------------------------------------------------
    const AVAILABLE_STATUS_SRC = 'improvement_status_available_mini'; // Gelbes Upgrade-verfuegbar-Icon
    const INJECT_BTN_ID = 'lea-upgrade-scan-btn';

    // UI Elemente im Gebäude
    const SETTINGS_BTN_SELECTOR = LEA_CONFIG.SETTINGS_BTN_SELECTOR;
    const IMPROVEMENT_ARROW_SRC = 'improvement_arrow';
    const BACK_BTN_SELECTOR = LEA_CONFIG.BACK_BTN_SELECTOR;

    // Dialog
    const DIALOG_SELECTOR = LEA_CONFIG.DIALOG_SELECTOR;
    const TITLE_SELECTOR = '.text-h1';

    // Status
    let isUpgrading = false;
    let stopRequested = false;

    // -----------------------------------------------------------------------
    // UI: STOP & BUTTON STATES
    // -----------------------------------------------------------------------
    function updateButtonState() {
        const btn = document.getElementById(INJECT_BTN_ID);
        if (!btn) return;
        const inner = btn.querySelector('.lea-injected-btn-inner');

        if (isUpgrading) {
            btn.classList.add('lea-btn-running');
            if (inner) inner.innerHTML = 'STOP';
        } else {
            btn.classList.remove('lea-btn-running');
            if (inner) inner.innerHTML = 'Auto<br>Upgrade';
        }
    }

    function showFloatingStopButton() {
        if (document.getElementById('lea-upgrade-stop-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'lea-upgrade-stop-btn';
        btn.className = 'bb-base-button variant--danger size--md theme--light lea-floating-stop-btn';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center';
        inner.textContent = 'STOP';
        btn.appendChild(inner);

        btn.addEventListener('click', () => {
            stopRequested = true;
            btn.classList.add('lea-btn-disabled');
            inner.textContent = 'Stoppe...';
        });
        document.body.appendChild(btn);
    }

    function removeFloatingStopButton() {
        const btn = document.getElementById('lea-upgrade-stop-btn');
        if (btn) btn.remove();
    }

    // -----------------------------------------------------------------------
    // HILFSFUNKTIONEN (Warten & UI-Prüfungen)
    // -----------------------------------------------------------------------

    function isUpgradeOverviewOpen() {
        return !!document.querySelector('a[href="#/buildings/upgrades"].router-link-exact-active');
    }


    // -----------------------------------------------------------------------
    // SUCH-FUNKTIONEN FÜR UPGRADES
    // -----------------------------------------------------------------------

    /**
     * Prüft, ob ein Gebäude anhand seines Namens von Upgrades ausgeschlossen werden soll.
     * @param {HTMLElement} card - Das Gebäudekarten-Element.
     * @returns {boolean} True, wenn das Gebäude übersprungen werden soll.
     */
    function shouldSkipBuilding(card) {
        const excludeSetting = LEA_CONFIG.settings.excludeUpgradeNames;
        if (!excludeSetting) return false;

        const cardText = (card.textContent || '').toLowerCase();
        const terms = excludeSetting.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);

        for (const term of terms) {
            if (cardText.includes(term)) {
                // Versuche, den echten Namen und die Straße für ein schöneres Log auszulesen
                const title = card.querySelector('.text-h2, p')?.textContent?.trim() || '';
                const street = card.querySelector('.text-p2-700, p:nth-of-type(2)')?.textContent?.trim() || '';
                const cleanName = street ? `${title} (${street})` : title;
                const logName = cleanName || cardText.replace(/\s+/g, ' ').trim();

                console.log(`[LEA Upgrade] Überspringe Gebäude wegen Ausschlusskriterium "${term}":`, logName);
                return true;
            }
        }
        return false;
    }

    function findNextAvailableBuildingArrow() {
        const btnContainers = document.querySelectorAll('[data-tutorial-id="building-list-item-buttons"]');
        for (const container of btnContainers) {
            const card = container.closest('[class*="building-card"]');
            if (!card) continue;

            const hasAvailable = !!card.querySelector(`img[src*="${AVAILABLE_STATUS_SRC}"]`);
            if (!hasAvailable) continue;

            // Name prüfen, ob das Gebäude übersprungen werden soll
            if (shouldSkipBuilding(card)) continue;

            const arrowBtn = container.querySelector(LEA_CONFIG.ARROW_BTN_SELECTOR)?.closest('button');
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

    /**
     * Sucht die nächste Produktionslinie mit sichtbarem Upgrade-Pfeil.
     * Gibt den Zahnrad-Button zurück, oder null wenn keine mehr vorhanden.
     * KEIN blinder Durchlauf aller Linien – gesperrte Produkte werden
     * separat in Schritt 3b (nur Linie 1) geprüft.
     */
    function findNextLineToProcess() {
        const settingsBtns = document.querySelectorAll(SETTINGS_BTN_SELECTOR);
        for (const btn of settingsBtns) {
            if (btn.querySelector(`img[src*="${IMPROVEMENT_ARROW_SRC}"]`) &&
                btn.getBoundingClientRect().width > 0) {
                return btn;
            }
        }
        return null;
    }

    /**
     * Gibt den ersten sichtbaren Zahnrad-Button (= Linie 1) zurück.
     * Wird in Schritt 3b genutzt: Alle Produkte (auch gesperrte) sind in Linie 1 sichtbar.
     * Das Freischalten in Linie 1 gilt automatisch für alle Linien.
     */
    function findFirstSettingsBtn() {
        const btns = document.querySelectorAll(SETTINGS_BTN_SELECTOR);
        for (const btn of btns) {
            if (btn.getBoundingClientRect().width > 0) return btn;
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

    function findLockedProductButton() {
        // Die gesperrten Produkte haben einen eigenen Container: data-tutorial-id="factory-line-configuration-research-button"
        // (Das Schloss-Bild ist ein Sibling des Buttons, NICHT im Button selbst!)
        const researchContainers = document.querySelectorAll('[data-tutorial-id="factory-line-configuration-research-button"]');
        for (const container of researchContainers) {
            // SICHERHEITSCHECK: Ist WIRKLICH ein Schloss-Icon in diesem Container?
            // (Manchmal behält das Spiel die tutorial-id auch nach dem Freischalten noch bei!)
            const hasLock = !!container.querySelector('img[src*="locked"], img[src*="lock"], img[src*="schloss"]');
            if (!hasLock) continue;

            const btn = container.querySelector('button');
            if (btn && btn.getBoundingClientRect().width > 0) {
                return btn;
            }
        }

        // Fallback: Suchen wir nach dem Schloss-Bild irgendwo auf der Seite
        const allLockImgs = document.querySelectorAll('img[src*="locked"], img[src*="lock"], img[src*="schloss"]');
        for (const lock of allLockImgs) {
            // Das Schloss ist ein Sibling vom Button oder im gleichen Container
            const container = lock.closest('.relative') || lock.parentElement;
            if (container) {
                const btn = container.querySelector('button');
                if (btn && btn.getBoundingClientRect().width > 0) {
                    return btn;
                }
            }
        }
        return null;
    }

    async function handleUpgradeDialog() {
        // Warte auf Dialog (max 1500ms)
        const dialogAppeared = await waitForElementToAppear(DIALOG_SELECTOR, 1500, () => stopRequested);
        if (!dialogAppeared) return;

        // waitForElementToAppear garantiert, dass das Element existiert
        const dialog = document.querySelector(DIALOG_SELECTOR);
        const titleEl = dialog.querySelector(TITLE_SELECTOR);
        const titleText = (titleEl && titleEl.textContent || '').trim();
        if (!/upgrade|freischalten/i.test(titleText)) return;

        let targetBtn = null;

        // 1. Suche GEZIELT nach Spielgeld-Button (cur_bucks).
        //    '/cur_/' würde auch Spielgold-Buttons (cur_gold o.ä.) treffen!
        const bucksImg = Array.from(dialog.querySelectorAll('button img')).find(img => {
            const src = img.getAttribute('src') || img.src || '';
            return src.includes('cur_bucks');
        });
        if (bucksImg) targetBtn = bucksImg.closest('button');

        // 2. Fallback: Suche nach typischem Bestätigungs-Text
        if (!targetBtn) {
            targetBtn = Array.from(dialog.querySelectorAll('button')).find(b => {
                const text = b.textContent.toLowerCase();
                return (text.includes('freischalten') || text.includes('upgrade') ||
                    text.includes('bestätigen') || text.includes('kaufen')) &&
                    !b.hasAttribute('disabled');
            });
        }

        if (targetBtn && !targetBtn.hasAttribute('disabled')) {
            console.log('[LEA Upgrade] Klicke Dialog-Bestätigung...');
            targetBtn.click();
            await waitForElementToDisappear(DIALOG_SELECTOR, 3000, () => stopRequested);
        } else {
            // Fallback: Wenn wir es nicht klicken können (zu wenig Geld), Dialog schließen
            console.warn('[LEA Upgrade] Dialog kann nicht bestätigt werden. Schließe ihn...');
            const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(b =>
                (b.textContent.includes('Abbrechen') || b.textContent.includes('Schließen')) &&
                !b.hasAttribute('disabled')
            );
            if (cancelBtn) cancelBtn.click();
            await waitForElementToDisappear(DIALOG_SELECTOR, 3000, () => stopRequested);
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
        stopRequested = false;
        updateButtonState();
        showFloatingStopButton();

        try {
            console.log('[LEA Upgrade] Starte Auto-Upgrade Ablauf...');

            let hasMoreBuildings = true;

            while (hasMoreBuildings) {
                if (stopRequested) throw new Error('STOP');

                // Schritt 1: Liste nach oben scrollen, damit Virtual Scrolling alle Elemente lädt
                const anchorCard = document.querySelector('[class*="building-card"]');
                if (anchorCard) {
                    let scrollContainer = anchorCard.parentElement;
                    while (scrollContainer && scrollContainer !== document.body) {
                        const style = window.getComputedStyle(scrollContainer);
                        if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
                            scrollContainer.classList.contains('scroll')) {
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
                    break;
                }

                console.log('[LEA Upgrade] Gebäude mit Upgrade gefunden, betrete Gebäude...');
                arrowBtn.click();

                // Warte bis wir aus der Übersicht raus sind (Gebäude lädt)
                const openStartTime = Date.now();
                while (isUpgradeOverviewOpen()) {
                    if (stopRequested) throw new Error('STOP');
                    if (Date.now() - openStartTime > 3000) {
                        console.error('[LEA Upgrade] Gebäude hat sich nicht geöffnet.');
                        break;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
                await new Promise(r => setTimeout(r, 500)); // UI kurz setzen lassen

                // Schritt 3: Alle sichtbaren Upgrades abarbeiten
                // (Gesperrte Produkte → Schritt 3b, gezielt nur Linie 1)
                let hadAnyUpgradeThisPass = false;
                let hasMoreUpgrades = true;
                let emergencyExitCounter = 0;

                while (hasMoreUpgrades) {
                    if (stopRequested) throw new Error('STOP');
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
                        hadAnyUpgradeThisPass = true;
                        hasMoreUpgrades = true;
                        await new Promise(r => setTimeout(r, 300)); // UI setzen lassen
                        continue;
                    }

                    // 3.2 Produktionslinien MIT sichtbarem Upgrade-Pfeil
                    //     Kein blinder Durchlauf – gesperrte Produkte → Schritt 3b
                    const lineTarget = findNextLineToProcess();
                    if (lineTarget) {
                        console.log('[LEA Upgrade] Zahnrad mit Upgrade-Pfeil gefunden, betrete Produktionslinie...');
                        lineTarget.click();

                        // Warte bis Linieneinstellungen offen sind
                        await waitForElementToAppear('.improvements-entry', 2000, () => stopRequested);
                        await new Promise(r => setTimeout(r, 300));

                        // Alle Verbesserungen & gesperrte Produkte in dieser Linie abarbeiten
                        let lineEmergencyCounter = 0;
                        while (lineEmergencyCounter++ < 30) {
                            if (stopRequested) throw new Error('STOP');
                            const improvementBtn = findImprovementButton();
                            if (improvementBtn) {
                                console.log('[LEA Upgrade] Gelber Verbesserungs-Button gefunden, klicke...');
                                improvementBtn.click();
                                await handleUpgradeDialog();
                                hadAnyUpgradeThisPass = true;
                                await new Promise(r => setTimeout(r, 400));
                                continue;
                            }

                            const lockedProductBtn = findLockedProductButton();
                            if (lockedProductBtn) {
                                console.log('[LEA Upgrade] Gesperrten Produkt-Button gefunden, klicke zum Freischalten...');
                                lockedProductBtn.click();
                                await handleUpgradeDialog();
                                hadAnyUpgradeThisPass = true;
                                await new Promise(r => setTimeout(r, 400));
                                continue;
                            }

                            break; // Nichts mehr in dieser Linie
                        }

                        // Zurück zur Gebäude-Ansicht
                        const backBtn = document.querySelector(BACK_BTN_SELECTOR);
                        if (backBtn) {
                            console.log('[LEA Upgrade] Verlasse Linieneinstellungen...');
                            backBtn.click();
                            await waitForElementToDisappear('.improvements-entry', 2000, () => stopRequested);
                            await new Promise(r => setTimeout(r, 500));
                        }

                        hasMoreUpgrades = true;
                        continue;
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

                // Schritt 3b: Keine sichtbaren Upgrades gefunden → nur Linie 1 auf gesperrte Produkte prüfen.
                //             Alle Produkte (auch gesperrte) sind in Linie 1 sichtbar.
                //             Das Freischalten in Linie 1 gilt automatisch für alle Linien.
                if (!hadAnyUpgradeThisPass) {
                    console.log('[LEA Upgrade] Keine sichtbaren Upgrades → prüfe Linie 1 auf gesperrte Produkte...');

                    const firstLineBtn = findFirstSettingsBtn();
                    if (firstLineBtn) {
                        firstLineBtn.click();
                        await waitForElementToAppear('.improvements-entry', 2000, () => stopRequested);
                        await new Promise(r => setTimeout(r, 300));

                        let lineCounter = 0;
                        while (lineCounter++ < 30) {
                            if (stopRequested) throw new Error('STOP');
                            const lockedProductBtn = findLockedProductButton();
                            if (lockedProductBtn) {
                                console.log('[LEA Upgrade] Gesperrtes Produkt in Linie 1 gefunden, freischalten...');
                                lockedProductBtn.click();
                                await handleUpgradeDialog();
                                await new Promise(r => setTimeout(r, 400));
                                continue;
                            }
                            break;
                        }

                        const backBtnLine1 = document.querySelector(BACK_BTN_SELECTOR);
                        if (backBtnLine1) {
                            console.log('[LEA Upgrade] Verlasse Linie 1...');
                            backBtnLine1.click();
                            await waitForElementToDisappear('.improvements-entry', 2000, () => stopRequested);
                            await new Promise(r => setTimeout(r, 500));
                        }
                    }
                }

                // Schritt 4: Gebäude komplett fertig -> Zurück zur Upgrade-Liste
                console.log('[LEA Upgrade] Kein weiteres Upgrade im Gebäude, klicke Zurück zur Liste...');
                const backBtn = document.querySelector(BACK_BTN_SELECTOR);
                if (backBtn) {
                    backBtn.click();

                    // Warte darauf, dass die Upgrade-Übersicht wieder aktiv ist
                    const backStartTime = Date.now();
                    while (!isUpgradeOverviewOpen()) {
                        if (stopRequested) throw new Error('STOP');
                        if (Date.now() - backStartTime > 3000) break;
                        await new Promise(r => setTimeout(r, 50));
                    }
                    await new Promise(r => setTimeout(r, 500)); // Kurz warten bis Liste gerendert ist
                }
            }

        } catch (e) {
            if (e.message === 'STOP') {
                console.log('[LEA Upgrade] Auto-Upgrade gestoppt vom Nutzer.');
                showToast('Auto-Upgrade gestoppt.');
            } else {
                console.error('[LEA Upgrade] Fehler im Ablauf:', e);
            }
        } finally {
            isUpgrading = false;
            stopRequested = false;
            updateButtonState();
            removeFloatingStopButton();
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

        const headerContainer = document.querySelector('img[src*="improvement_arrow"]')
            ?.closest('.flex.flex-nowrap.items-center')
            ?.querySelector('.gap-md.flex');
        if (!headerContainer) return;

        const blueprintBtn = headerContainer.querySelector('button');

        const btn = document.createElement('button');
        btn.id = INJECT_BTN_ID;
        btn.type = 'button';
        btn.className = 'bb-base-button variant--neutral size--md shape--square theme--light lea-injected-btn';
        btn.title = 'Nächstes verfügbares Upgrade anklicken';

        const inner = document.createElement('div');
        inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
        inner.innerHTML = 'Auto<br>Upgrade';
        btn.appendChild(inner);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isUpgrading) {
                stopRequested = true;
                inner.innerHTML = 'Stoppe...';
            } else {
                executeAutoUpgrade();
            }
        });

        if (blueprintBtn) {
            headerContainer.insertBefore(btn, blueprintBtn);
        } else {
            headerContainer.appendChild(btn);
        }
        updateButtonState();
    }

    // -----------------------------------------------------------------------
    // INIT
    // -----------------------------------------------------------------------
    function init() {
        console.log('[LEA Auto Upgrade] Initialisiert v1.0.13');

        injectScanButton();

        let isHandlingMutations = false;
        const observer = new MutationObserver(() => {
            if (!isHandlingMutations) {
                isHandlingMutations = true;
                requestAnimationFrame(() => {
                    // Der Observer hält den Button am Leben, wenn das Spiel die UI neu rendert
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
