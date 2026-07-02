# Logistics Empire Assistant (LEA) - Projekt-Regeln & Entwicklungs-Richtlinien

Dieses Dokument fasst alle zentralen Regeln, Design-Richtlinien und technischen Best Practices für die Entwicklung von *Logistics Empire Assistant (LEA)* Tampermonkey-Skripten zusammen. **Jede Änderung und jedes neue Skript müssen diesen Regeln entsprechen.**

---

## 1. Architektur & Dateistruktur

*   **Zentrale CSS-Verwaltung:**
    *   Alle CSS-Regeln liegen ausschließlich in [lea-shared-styles.css](file:///d:/Clouds/OneDrive/Apps/Tampermonkey/Logistics-Empire-Scripts/lea-shared-styles.css).
    *   Die Stile werden über das Loader-Skript [lea-shared-styles.user.js](file:///d:/Clouds/OneDrive/Apps/Tampermonkey/Logistics-Empire-Scripts/lea-shared-styles.user.js) global in das Spiel injiziert.
    *   **Regel:** Einzelne Skripte dürfen **keine** eigenen Stylesheets injizieren oder `@grant GM_addStyle` nutzen. Sie verlassen sich vollständig auf die global verfügbaren Klassen aus dem Shared Stylesheet.
*   **Tampermonkey-Ressourcen-Caching:**
    *   Da Tampermonkey die `@resource`-Dateien cached, muss bei jeder Änderung in [lea-shared-styles.css](file:///d:/Clouds/OneDrive/Apps/Tampermonkey/Logistics-Empire-Scripts/lea-shared-styles.css) zwingend die `@version` im Loader-Skript [lea-shared-styles.user.js](file:///d:/Clouds/OneDrive/Apps/Tampermonkey/Logistics-Empire-Scripts/lea-shared-styles.user.js) erhöht werden. Nur so lädt Tampermonkey das CSS für den Nutzer neu.

---

## 2. UI- & Design-Richtlinien (LEA Style Guide)

*   **Keine Inline-Styles im JS-Code:**
    *   Niemals statische Layout-Zuweisungen (wie Breiten, Höhen, Paddings, Flex-Attribute) über `element.style.prop = val` im JavaScript-Code vergeben.
    *   Nutzen Sie stattdessen vordefinierte Klassen in [lea-shared-styles.css](file:///d:/Clouds/OneDrive/Apps/Tampermonkey/Logistics-Empire-Scripts/lea-shared-styles.css) oder die Standard-Tailwind-Klassen des Spiels.
*   **Injektion von Knöpfen (Buttons):**
    *   Buttons müssen dem LEA Style Guide entsprechen und die Klassen-Kombination `bb-base-button variant--neutral size--md theme--light lea-injected-btn` nutzen.
    *   Bei quadratischen Buttons (z. B. im Header) wird zusätzlich `.shape--square` verwendet.
*   **Button-Zustände:**
    *   **Laufend:** `.lea-btn-running` (Rot) für aktive Automatisierungen. Der Text muss währenddessen auf `'STOP'` geändert werden.
    *   **Deaktiviert:** `.lea-btn-disabled` (Grau, `cursor: not-allowed`) für nicht anklickbare Buttons.
*   **Zentrale Toast-Benachrichtigung:**
    *   Erfolgsmeldungen oder Fehleranzeigen werden mit der Klasse `.lea-toast` zentriert eingeblendet.
*   **Schwebender STOP-Button:**
    *   Für Hintergrundprozesse (z. B. Auto Upgrade) muss ein schwebender Stop-Button mit der Klasse `.lea-floating-stop-btn` am oberen rechten Bildschirmrand (`position: fixed`) eingebunden werden.
*   **Eigene Dropdown-Filter:**
    *   Nutzen Sie die CSS-Klassen `.lea-filter-container`, `.lea-dropdown-arrow`, `.lea-filter-dropdown` und `.lea-filter-dropdown-content` für einheitliche Filtermuschel-Menüs.

---

## 3. Programmier-Richtlinien & Performance

*   **Nutzung von MutationObserver & requestAnimationFrame (Kein setInterval):**
    *   Verwenden Sie zum Überwachen von DOM-Änderungen immer einen `MutationObserver` in Kombination mit `requestAnimationFrame`, anstatt periodisch mit `setInterval` das DOM abzufragen. Das schont die Performance und verhindert Verzögerungen.
*   **Intelligentes Lifecycle-Management:**
    *   Automatisierungen sollten sich intelligent verhalten: Aktivieren, wenn die zugehörige UI geöffnet wird (z. B. Handelszentrum) und automatisch nach einer kurzen Verzögerung (z. B. 10 Sekunden) deaktivieren bzw. bereinigen, wenn das Fenster geschlossen wird.
*   **Lokale Zustandsspeicherung (Settings):**
    *   Optionen und Aktivierungszustände (An/Aus) werden in `localStorage` gespeichert, um nach einem Seiten-Reload erhalten zu bleiben.
*   **Navigation & Auto-Return:**
    *   Wenn ein Skript selbstständig in Menüs navigiert (z. B. in ein Gebäude klickt), soll es nach getaner Arbeit auch wieder automatisch zurückgehen.
    *   **Sicherheitsregel:** Gehen Sie nur dann automatisch zurück (z. B. Klick auf den "Zurück"-Pfeil des Spiels), wenn das Skript die Navigation auch selbst gestartet hat. Schließen Sie niemals Fenster, die der Nutzer manuell geöffnet hat.
*   **Warten auf UI-Elemente (Keine statischen Timeouts/Timer):**
    *   Verwenden Sie zum Warten auf das Erscheinen oder Verschwinden von DOM-Elementen (z. B. beim Laden von Dialogen, Linieneinstellungen oder Menü-Kacheln) immer die standardisierten asynchronen Hilfsfunktionen `waitForElementToAppear(selector, timeout)` und `waitForElementToDisappear(selector, timeout)`.
    *   Vermeiden Sie nackte `setTimeout`-Aufrufe oder feste Timer, um auf asynchrone Spieländerungen zu warten. Es muss stattdessen dynamisch geprüft werden, ob das gesuchte Element bereits erschienen bzw. verschwunden ist. Damit läuft das Skript maximal performant und fehlerfrei.
*   **Klick-Simulation (simulateClick vs. native.click()):**
    *   Verwenden Sie für komplexe Spiel-UI-Elemente, verschachtelte Bild-Icons (z. B. den Transport-Assistenten, Quest-Objective-Pfeile) oder Custom Vue-Komponenten immer die Hilfsfunktion `simulateClick(element)` aus den Shared Helpers.
    *   Diese simuliert die vollständige Klick-Kette (`mousedown` -> `mouseup` -> `click`) mit Event-Bubbling, was für moderne Frameworks wie Vue.js oft notwendig ist, um die Logik auszulösen.
    *   Die native Methode `element.click()` darf nur für einfache, native HTML-Buttons verwendet werden. Im Zweifel sollte immer `simulateClick` bevorzugt werden, da sie robuster und fehlerresistenter gegenüber asynchronen UI-Zuständen ist.

---

## 4. Versionierung & Update-Workflow

*   **Semantische Versionierung (SemVer):**
    *   Versionsnummern müssen dreistellig sein (`MAJOR.MINOR.PATCH`):
        *   `PATCH` (+0.0.1): Bugfixes, kleine Anpassungen und UI-Tweaks. **Wichtig:** Bei regulären Anpassungen wird *immer* nur die letzte Ziffer hochgezählt. Diese kann problemlos zweistellig werden (z. B. nach `1.0.9` folgt `1.0.10` statt `1.1.0`).
        *   `MINOR` (+0.1.0): Deutlich spürbare neue Features oder völlig neue Automatisierungen.
        *   `MAJOR` (+1.0.0): Umfassende Refactorings, grundlegende strukturelle Änderungen.
*   **Versionierung bei lokalen Änderungen & Git-Push-Status:**
    *   **Regel:** Wenn Code-Änderungen an einer Datei vorgenommen werden, die bereits auf GitHub gepusht wurde (d. h. lokaler Stand entspricht dem Remote-Stand), muss die `@version` im Metadaten-Header erhöht werden.
    *   **Ausnahme:** Wenn eine Datei lokal modifiziert wurde, die `@version` bereits erhöht wurde, die Änderungen aber noch **nicht** auf GitHub gepusht wurden (unpushed commits oder uncommitted changes), darf die `@version` bei weiteren Bearbeitungen dieser Datei **nicht** erneut erhöht werden. Sie bleibt unverändert, bis die Version gepusht wurde.
    *   **KI-Prüfpflicht:** Die KI muss vor jeder Änderung der Skript-Version explizit prüfen (via `git fetch` und Überprüfung der Remote-Version auf GitHub), ob die aktuelle Version bereits auf GitHub existiert, um Fehler bei der Versionsbestimmung zu vermeiden.
*   **Userscript-Metadaten:**
    *   Alle Skripte müssen standardisierte `@updateURL` und `@downloadURL` im Header besitzen, die auf die Raw-Version des GitHub-Repositories verweisen:
        ```javascript
        // @updateURL    https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/skript-name.user.js
        // @downloadURL  https://raw.githubusercontent.com/XschlexX/Logistics-Empire-Scripts/main/skript-name.user.js
        ```
    *   **Update-Pflicht:** Nach jeder Code-Änderung muss die `@version` im Header erhöht und gepusht werden, damit Tampermonkey das Update erkennt (unter Beachtung der Push-Status-Regel oben).
