// UI translations. To add a language, copy the `en` block, translate the values and add it here.
// The language is picked from the browser/phone settings, falling back to English.
// Placeholders like {n} are filled in by t("key", { n: 2 }).

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
    setUp: "Set up",
    brightness: "Brightness",
    other: "Other",

    settings: "Settings",
    back: "Back",
    name: "Name",
    room: "Room",
    noRoom: "No room",
    add: "Add",
    delete: "Delete",
    remove: "Remove",
    confirm: "Sure?",
    moveUp: "Move up",
    moveDown: "Move down",
    saveError: "Could not save: {error}",

    newDevices: "New devices",
    searching: "Looking for devices…",
    noNewDevices: "No new devices. New Shelly devices on your network show up here by themselves.",
    searchAgain: "Search again",
    cantFind: "Can't find your device?",
    addByIpHint: "Make sure it's powered on and connected to your WiFi, or enter its IP address:",
    ipAddress: "IP address",
    ipPlaceholder: "e.g. 192.168.1.50",
    notFoundAt: "No Shelly found at {host}.",
    added: "Added",
    allAdded: "All channels added",
    notSupported: "This older model isn't supported yet.",
    noChannels: "No controllable channels.",
    channel: "Channel {n}",
    kindSwitch: "Switch",
    kindLight: "Dimmer",

    rooms: "Rooms",
    newRoom: "New room",
    addRoom: "Add room",

    devices: "Devices",
    noDevices: "No devices added yet.",
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
    setUp: "Kom i gang",
    brightness: "Lysstyrke",
    other: "Andre",

    settings: "Indstillinger",
    back: "Tilbage",
    name: "Navn",
    room: "Rum",
    noRoom: "Intet rum",
    add: "Tilføj",
    delete: "Slet",
    remove: "Fjern",
    confirm: "Sikker?",
    moveUp: "Flyt op",
    moveDown: "Flyt ned",
    saveError: "Kunne ikke gemme: {error}",

    newDevices: "Nye enheder",
    searching: "Leder efter enheder…",
    noNewDevices: "Ingen nye enheder. Nye Shelly'er på dit netværk dukker selv op her.",
    searchAgain: "Søg igen",
    cantFind: "Kan du ikke finde din enhed?",
    addByIpHint: "Tjek at den er tændt og på dit WiFi, eller skriv dens IP-adresse:",
    ipAddress: "IP-adresse",
    ipPlaceholder: "fx 192.168.1.50",
    notFoundAt: "Fandt ingen Shelly på {host}.",
    added: "Tilføjet",
    allAdded: "Alle kanaler er tilføjet",
    notSupported: "Denne ældre model understøttes ikke endnu.",
    noChannels: "Ingen kanaler, der kan styres.",
    channel: "Kanal {n}",
    kindSwitch: "Kontakt",
    kindLight: "Lysdæmper",

    rooms: "Rum",
    newRoom: "Nyt rum",
    addRoom: "Tilføj rum",

    devices: "Enheder",
    noDevices: "Ingen enheder tilføjet endnu.",
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

export function t(key, params = {}) {
  const text = messages[lang][key] ?? messages.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

// Fills elements marked with data-i18n (text), data-i18n-aria (aria-label) or
// data-i18n-placeholder (placeholder).
export function translate(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
}
