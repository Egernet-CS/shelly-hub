import { api } from "./api.js";
import { h } from "./dom.js";
import { lang, t, translate } from "./i18n.js";
import { createSettings } from "./settings.js";

document.documentElement.lang = lang;
translate();

const roomsEl = document.getElementById("rooms");
const settingsEl = document.getElementById("settings");
const titleEl = document.getElementById("title");
const backEl = document.getElementById("back");
const settingsLinkEl = document.getElementById("settings-link");
const statusEl = document.getElementById("status");
const connEl = document.getElementById("conn");
const roomTpl = document.getElementById("room-tpl");
const tileTpl = document.getElementById("tile-tpl");

const tiles = new Map(); // device id -> { el, device, dragging }
let snapshot = { rooms: [], devices: [] };

let statusTimer = null;
function showStatus(text) {
  statusEl.textContent = text;
  statusEl.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (statusEl.hidden = true), 5000);
}

const settings = createSettings(settingsEl, { status: showStatus });

// ---- Routing: #settings shows settings, anything else the home view ----

function route() {
  const inSettings = location.hash === "#settings";
  roomsEl.hidden = inSettings;
  settingsEl.hidden = !inSettings;
  backEl.hidden = !inSettings;
  settingsLinkEl.hidden = inSettings;
  titleEl.textContent = t(inSettings ? "settings" : "home");
  window.scrollTo(0, 0);
  if (inSettings) settings.opened();
}
window.addEventListener("hashchange", route);
route();

// ---- Home view ----

function setConn(state, text) {
  connEl.dataset.state = state;
  connEl.textContent = text;
}

function statusText(device) {
  if (!device.online) return t("offline");
  if (!device.on) return t("off");
  const parts = [device.kind === "light" && device.brightness != null ? `${device.brightness}%` : t("on")];
  if (device.power != null && device.power > 0) parts.push(`${Math.round(device.power)} W`);
  return parts.join(" · ");
}

function renderHome({ rooms, devices }) {
  roomsEl.replaceChildren();
  tiles.clear();
  const roomIds = new Set(rooms.map((r) => r.id));
  const groups = [
    ...rooms.map((room) => ({ name: room.name, devices: devices.filter((d) => d.room === room.id) })),
    { name: t("other"), devices: devices.filter((d) => !roomIds.has(d.room)) },
  ];
  for (const group of groups) {
    if (group.devices.length === 0) continue;
    const roomEl = roomTpl.content.firstElementChild.cloneNode(true);
    roomEl.querySelector(".room-name").textContent = group.name;
    const tilesEl = roomEl.querySelector(".tiles");
    for (const device of group.devices) tilesEl.append(createTile(device));
    roomsEl.append(roomEl);
  }
  if (tiles.size === 0) {
    roomsEl.append(
      h("div", { class: "empty" },
        h("p", {}, t("empty")),
        h("a", { class: "btn btn-primary", href: "#settings" }, t("setUp")),
      ),
    );
  }
}

function createTile(device) {
  const el = tileTpl.content.firstElementChild.cloneNode(true);
  translate(el);
  const entry = { el, device, dragging: false };
  tiles.set(device.id, entry);

  el.querySelector(".tile-toggle").addEventListener("click", () => {
    send(device.id, { toggle: true }, entry);
  });

  const dimmer = el.querySelector(".dimmer");
  if (device.kind === "light") {
    dimmer.hidden = false;
    dimmer.addEventListener("pointerdown", () => (entry.dragging = true));
    dimmer.addEventListener("input", () => {
      el.querySelector(".tile-status").textContent = `${dimmer.value}%`;
    });
    dimmer.addEventListener("change", () => {
      entry.dragging = false;
      send(device.id, { brightness: Number(dimmer.value) }, entry);
    });
  }

  updateTile(entry, device);
  return el;
}

function updateTile(entry, device) {
  entry.device = device;
  const { el } = entry;
  const button = el.querySelector(".tile-toggle");
  el.classList.toggle("is-on", device.online && device.on === true);
  el.classList.toggle("is-offline", !device.online);
  button.disabled = !device.online;
  button.setAttribute("aria-pressed", String(device.on === true));
  button.setAttribute("aria-label", `${device.name}: ${statusText(device)}`);
  el.querySelector(".tile-name").textContent = device.name;

  const dimmer = el.querySelector(".dimmer");
  dimmer.disabled = !device.online;
  if (!entry.dragging) {
    el.querySelector(".tile-status").textContent = statusText(device);
    if (device.brightness != null) dimmer.value = String(device.brightness);
  }
}

async function send(id, cmd, entry) {
  entry.el.classList.add("is-pending");
  try {
    await api.command(id, cmd);
  } catch (err) {
    console.error(err);
    entry.el.querySelector(".tile-status").textContent = t("error");
  } finally {
    entry.el.classList.remove("is-pending");
  }
}

// ---- Live connection ----

let retryMs = 1000;
let retryTimer = null;

function connect() {
  retryTimer = null;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/ws`);

  ws.addEventListener("open", () => {
    retryMs = 1000;
    setConn("online", t("connected"));
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "snapshot") {
      snapshot = msg.data;
      renderHome(snapshot);
      settings.update(snapshot);
    } else if (msg.type === "discovery") {
      settings.updateDiscovery(msg.data);
    } else if (msg.type === "device") {
      snapshot.devices = snapshot.devices.map((d) => (d.id === msg.data.id ? msg.data : d));
      const entry = tiles.get(msg.data.id);
      if (entry) updateTile(entry, msg.data);
    }
  });

  ws.addEventListener("close", () => {
    setConn("offline", t("disconnected"));
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 15000);
  });
}

// Reconnect immediately when the app comes back to the foreground (phones suspend sockets).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && retryTimer) {
    clearTimeout(retryTimer);
    retryMs = 1000;
    connect();
  }
});

connect();
