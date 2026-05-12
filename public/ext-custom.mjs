// Renders a pi-tui Component (proxied from the server) as a webui modal,
// converts its ANSI output to HTML, and forwards browser keystrokes back as
// terminal escape sequences so the component's `handleInput(data)` sees the
// same input it would on a real TTY.
//
// On mobile, an on-screen toolbar sends the same escape sequences via touch
// so TUI components that expect keyboard navigation (e.g. the ask-user-
// question questionnaire) work without a physical keyboard.

import { ansiToHtml } from "./ansi.mjs";

// Key → terminal escape sequence — mirrors encodeKey() below but doesn't
// need a real KeyboardEvent, so the touch toolbar can dispatch directly.
function keyToSeq(key, shiftKey) {
  switch (key) {
    case "Enter": return "\r";
    case "Escape": return "\x1b";
    case "Tab": return shiftKey ? "\x1b[Z" : "\t";
    case "Backspace": return "\x7f";
    case "Delete": return "\x1b[3~";
    case "ArrowUp": return "\x1b[A";
    case "ArrowDown": return "\x1b[B";
    case "ArrowRight": return "\x1b[C";
    case "ArrowLeft": return "\x1b[D";
    case "Home": return "\x1b[H";
    case "End": return "\x1b[F";
    case "PageUp": return "\x1b[5~";
    case "PageDown": return "\x1b[6~";
    case " ": return " ";
    default: return key.length === 1 ? key : null;
  }
}

// Toolbar buttons for touch/mobile navigation. Each entry maps a visible
// label to the key it simulates and an optional `title` for screen-readers.
const TOOLBAR_KEYS = [
  { label: "\u25B2", key: "ArrowUp", title: "Up" },
  { label: "\u25BC", key: "ArrowDown", title: "Down" },
  { label: "\u23CE", key: "Enter", title: "Select / Enter" },
  { label: "\u2423", key: " ", title: "Space (toggle)" },
  { label: "\u21E5", key: "Tab", title: "Tab (next question)" },
  { label: "\u2715", key: "Escape", title: "Cancel / Escape" },
];

export function createCustomOverlayHost({ root, send }) {
  let backdrop = null;
  let pre = null;
  let toolbar = null;
  let activeId = null;

  function ensureDom() {
    if (backdrop) return;
    backdrop = document.createElement("div");
    backdrop.className = "ext-custom-backdrop";
    backdrop.tabIndex = -1;

    const surface = document.createElement("div");
    surface.className = "ext-custom-surface";

    pre = document.createElement("pre");
    pre.className = "ext-custom-output";
    surface.appendChild(pre);

    toolbar = document.createElement("div");
    toolbar.className = "ext-custom-toolbar";
    for (const btn of TOOLBAR_KEYS) {
      const el = document.createElement("button");
      el.className = "ext-custom-toolbar-key";
      el.textContent = btn.label;
      el.title = btn.title || btn.label;
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        sendKey(btn.key);
      });
      toolbar.appendChild(el);
    }
    surface.appendChild(toolbar);

    backdrop.appendChild(surface);
    backdrop.hidden = true;
    backdrop.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) sendKey("Escape");
    });
    root.appendChild(backdrop);
  }

  function sendKey(key) {
    if (activeId === null) return;
    const data = keyToSeq(key, false);
    if (data !== null) {
      send({ type: "ext_ui_custom_input", payload: { id: activeId, data } });
    }
  }

  function open({ id, lines }) {
    ensureDom();
    activeId = id;
    setLines(lines);
    backdrop.hidden = false;
    backdrop.focus();
  }

  function update({ id, lines }) {
    if (id !== activeId) return;
    setLines(lines);
  }

  function close({ id }) {
    if (id !== activeId) return;
    activeId = null;
    if (backdrop) backdrop.hidden = true;
  }

  function setLines(lines) {
    if (!Array.isArray(lines)) lines = [];
    const html = lines.map((l) => ansiToHtml(l) || "&nbsp;").join("\n");
    pre.innerHTML = html;
  }

  function onKey(event) {
    if (activeId === null) return;
    const data = encodeKey(event);
    if (data === null) return;
    event.preventDefault();
    event.stopPropagation();
    send({ type: "ext_ui_custom_input", payload: { id: activeId, data } });
  }

  return { open, update, close };
}

// Translate a browser KeyboardEvent into a terminal escape sequence. Returns
// null when the event shouldn't be forwarded (modifier-only presses, IME
// composition, etc.).
function encodeKey(event) {
  if (event.isComposing) return null;
  const key = event.key;
  if (!key || key === "Dead" || key === "Unidentified") return null;
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return null;

  const SPECIAL = {
    Enter: "\r",
    Escape: "\x1b",
    Tab: event.shiftKey ? "\x1b[Z" : "\t",
    Backspace: "\x7f",
    Delete: "\x1b[3~",
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Home: "\x1b[H",
    End: "\x1b[F",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
  };
  if (SPECIAL[key] !== undefined) return SPECIAL[key];

  if (key.length === 1) {
    // Ctrl+letter → C0 control byte; preserve case for Ctrl+Shift+letter.
    if (event.ctrlKey && !event.metaKey) {
      const code = key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
      if (key === " ") return "\x00";
    }
    if (event.altKey && !event.ctrlKey && !event.metaKey) return "\x1b" + key;
    return key;
  }

  return null;
}
