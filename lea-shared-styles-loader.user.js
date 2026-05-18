// ==UserScript==
// @name         LEA Shared Styles Loader
// @namespace    le-tools
// @version      1.0.0
// @match        https://game.logistics-empire.com/*
// @description  Läd die geteilten CSS-Stile für alle LEA Assistant Skripte.
// @author       DonSanchos
// @resource     LEA_STYLES https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-shared-styles.css
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-shared-styles-loader.user.js
// @downloadURL  https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/lea-shared-styles-loader.user.js
// ==/UserScript==

(function () {
    'use strict';
    console.log('[LEA Shared Styles Loader] Lade geteilte CSS-Ressource...');
    try {
        const css = GM_getResourceText("LEA_STYLES");
        if (css) {
            GM_addStyle(css);
            console.log('[LEA Shared Styles Loader] Styles erfolgreich injiziert!');
        } else {
            console.warn('[LEA Shared Styles Loader] CSS-Ressource ist leer oder konnte nicht gelesen werden.');
        }
    } catch (e) {
        console.error('[LEA Shared Styles Loader] Fehler beim Laden des CSS:', e);
    }
})();
