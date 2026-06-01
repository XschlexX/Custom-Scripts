# LEA Assistant System - Design & UI Style Guide

Dieses Dokument dient als zentrales **Design- und UI-Handbuch** für alle *Logistics Empire Assistant (LEA)* Tampermonkey-Skripte. Es deklariert die standardisierten HTML-Strukturen, native Spielklassen und unsere maßgeschneiderten CSS-Klassen aus dem **Shared Stylesheet** ([lea-shared-styles.css](file:///d:/Clouds/OneDrive/Apps/Tampermonkey/Logistics-Empire-Scripts/lea-shared-styles.css)), um ein absolut konsistentes, nahtloses und premium wirkendes Benutzererlebnis über alle Automatisierungen hinweg zu garantieren.

---

## 1. Vereinheitlichte Injektions-Buttons (Toolbar & Header)

Um zu verhindern, dass jedes Skript eigene Style-Zuweisungen im JavaScript-Code verwaltet, nutzen alle Skripte ein **einziges, intelligentes Klassen-System** in den Shared Styles. Dieses passt sich automatisch an, je nachdem, ob der Button **quadratisch** (z. B. im Header neben Blaupausen) oder **rechteckig** (z. B. in Standard-Filterleisten) gerendert werden soll.

### HTML-Struktur (Template)
```javascript
const btn = document.createElement('button');
btn.id = 'dein-eindeutiger-button-id';
btn.type = 'button';
// WICHTIG: Nutze exakt diese Klassen-Kombination!
btn.className = 'bb-base-button variant--neutral size--md theme--light lea-injected-btn';

// Falls der Button quadratisch sein soll (z. B. Header / Auto Refill):
btn.classList.add('shape--square'); 

const inner = document.createElement('div');
inner.className = 'relative flex size-full items-center justify-center lea-injected-btn-inner';
inner.textContent = 'Auto\nRefill'; // Mehrzeiliger Text (\n) wird automatisch umbrochen!

btn.appendChild(inner);
```

### Zugehörige CSS-Definition in `lea-shared-styles.css`
```css
/* Basis-Layout für injizierte Buttons */
.lea-injected-btn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
}

/* Spezial-Regel für quadratische Buttons (z. B. Auto Refill im Header) */
.lea-injected-btn.shape--square {
    padding: 0 !important;
}

/* Spezial-Regel für rechteckige Standard-Buttons (z. B. Auto Order, Upgrade) */
.lea-injected-btn:not(.shape--square) {
    padding: 0 12px !important;
}

/* Innerer Text-Container (unterstützt flexiblen mehrzeiligen Text) */
.lea-injected-btn-inner {
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 12px !important;
    font-weight: bold !important;
    white-space: pre-line !important;
    text-align: center !important;
    line-height: 1.15 !important;
}
```

---

## 2. Status-Klassen für Buttons

Alle injizierten Buttons unterstützen standardisierte Statusfarben für **laufende Automatisierungen (Rot)** oder **deaktivierte Zustände (Grau)**:

### Automatisierung läuft (`.lea-btn-running`)
* **Beschreibung:** Ändert die Button-Farbe zu einem kräftigen, signalgebenden Rot und weißen Text.
* **Klasse:** `.lea-btn-running`
* **Nutzung:** `btn.classList.add('lea-btn-running');`
* **Textänderung:** Setze den Text währenddessen auf `'STOP'`.

### Button deaktiviert (`.lea-btn-disabled`)
* **Beschreibung:** Färbt den Button grau und zeigt den Deaktiviert-Cursor (`not-allowed`).
* **Klasse:** `.lea-btn-disabled`
* **Nutzung:** `btn.classList.add('lea-btn-disabled');`

---

## 3. Zentrale Toast-Benachrichtigung (`.lea-toast`)

Wird verwendet, um dem Benutzer kurze, elegante Erfolgsmeldungen oder Fehleranzeigen mittig über den Bildschirm einzublenden.

### HTML-Struktur & Animation (Template)
```javascript
function showToast(msg) {
    const existing = document.getElementById('lea-global-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'lea-global-toast';
    toast.className = 'lea-toast';
    toast.textContent = msg;

    document.body.appendChild(toast);

    setTimeout(() => {
        const el = document.getElementById('lea-global-toast');
        if (el) {
            el.style.opacity = '0';
            setTimeout(() => { if (el.parentNode) el.remove(); }, 300);
        }
    }, 2500);
}
```

### CSS-Definition in `lea-shared-styles.css`
```css
.lea-toast {
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    background-color: rgba(0, 0, 0, 0.85) !important;
    color: #fff !important;
    padding: 20px 40px !important;
    border-radius: 12px !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
    z-index: 99999 !important;
    font-size: 20px !important;
    font-weight: bold !important;
    text-align: center !important;
    pointer-events: none !important;
    transition: opacity 0.3s ease-in-out !important;
}
```

---

## 4. Schwebender STOP-Button (`.lea-floating-stop-btn`)

Wird am rechten oberen Bildschirmrand fest fixiert (`position: fixed`), sobald eine mehrschrittige Hintergrund-Routine startet (z. B. Auto Upgrade, Auto Refill), damit der Nutzer die Ausführung jederzeit abbrechen kann.

### HTML-Struktur (Template)
```javascript
const stopBtn = document.createElement('button');
stopBtn.id = 'lea-floating-stop-btn';
stopBtn.className = 'lea-floating-stop-btn';
stopBtn.textContent = '🛑 STOP Automatisierung';
document.body.appendChild(stopBtn);
```

### CSS-Definition in `lea-shared-styles.css`
```css
.lea-floating-stop-btn {
    position: fixed !important;
    top: 15px !important;
    right: 15px !important;
    z-index: 999999 !important;
    padding: 10px 20px !important;
    background-color: #F44336 !important;
    color: white !important;
    border: 2px solid white !important;
    border-radius: 8px !important;
    font-weight: bold !important;
    cursor: pointer !important;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5) !important;
    font-size: 14px !important;
}
```

---

## 5. Eigene Dropdown-Filter (`.lea-filter-dropdown`)

Wird für das Injizieren von Menüs und erweiterten Filtern verwendet (wie das Custom Filter Dropdown in der Gebäudeübersicht). Sie docken direkt an eine relative Basis an.

* **Container:** `.lea-filter-container` (mit `position: relative !important`)
* **Pfeil-Symbol:** `<span class="lea-dropdown-arrow"> ▼</span>`
* **Dropdown-Fenster:** `.lea-filter-dropdown` (mit `position: absolute !important; top: 100% !important; left: 0 !important; z-index: 1001 !important;`)
* **Inhalt-Wrapper:** `.lea-filter-dropdown-content`

---

## 📋 Best Practices für zukünftige Entwicklungen:
1. **Kein Inline-Style im JS-Code:** Definiere statische Größen, Paddings und Flex-Layouts niemals über `.style.x = y` im Userscript.
2. **Kombination mit nativen Klassen:** Nutze das Tailwind CSS des Spiels für Themes (`theme--light`), Farben (`variant--neutral`), Formen (`shape--square`) und Größen (`size--md`) und ergänze sie lediglich um unsere `lea-injected-btn` Klasse.
3. **Immer `!important` im CSS:** Da das Spiel selbst hoch-spezifische Tailwind-Selektoren nutzt, muss jede CSS-Regel in `lea-shared-styles.css` mit `!important` versehen werden, um das Standard-Styling zuverlässig zu überschreiben.
