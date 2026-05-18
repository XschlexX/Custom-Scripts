// ==UserScript==
// @name         (DEV) LEA Shared Styles
// @namespace    le-tools
// @version      1.0.0
// @match        https://game.logistics-empire.com/*
// @description  Lokal-Loader für geteilte CSS-Stile (direkt von Festplatte).
// @author       DonSanchos
// @resource     LEA_STYLES file:///D:/Clouds/OneDrive/Apps/Tampermonkey/Logistics-Empire-Scripts/lea-shared-styles.css
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';
    console.log('[LEA Shared Styles (DEV)] Lade lokale CSS-Ressource...');
    try {
        const css = GM_getResourceText("LEA_STYLES");
        if (css) {
            GM_addStyle(css);
            console.log('[LEA Shared Styles (DEV)] Styles erfolgreich aus lokaler Datei injiziert!');
        } else {
            console.warn('[LEA Shared Styles (DEV)] Lokale CSS-Ressource ist leer oder konnte nicht gelesen werden. Prüfe den file:/// Pfad und die TM-Berechtigungen.');
        }
    } catch (e) {
        console.error('[LEA Shared Styles (DEV)] Fehler beim Laden des lokalen CSS:', e);
    }
})();
