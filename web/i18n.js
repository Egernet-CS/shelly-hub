// UI translations. To add a language, copy the `en` block, translate the values and add it here.
// The language is picked from the browser/phone settings, falling back to English.

const messages = {
  en: {
    home: "Home",
    connecting: "Connecting…",
    connected: "Connected",
    disconnected: "No connection",
    on: "On",
    off: "Off",
    offline: "Offline",
    error: "Error – try again",
    empty: "No devices yet.",
    brightness: "Brightness",
  },
  da: {
    home: "Hjem",
    connecting: "Forbinder…",
    connected: "Forbundet",
    disconnected: "Ingen forbindelse",
    on: "Tændt",
    off: "Slukket",
    offline: "Offline",
    error: "Fejl – prøv igen",
    empty: "Ingen enheder endnu.",
    brightness: "Lysstyrke",
  },
};

function pickLanguage() {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lang = tag.toLowerCase().split("-")[0];
    if (lang in messages) return lang;
  }
  return "en";
}

export const lang = pickLanguage();

export function t(key) {
  return messages[lang][key] ?? messages.en[key] ?? key;
}

// Fills elements marked with data-i18n (text) or data-i18n-aria (aria-label).
export function translate(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}
