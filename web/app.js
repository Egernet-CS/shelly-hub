import { lang, t, translate } from "./i18n.js";

document.documentElement.lang = lang;
translate();

const roomsEl = document.getElementById("rooms");
const connEl = document.getElementById("conn");
const roomTpl = document.getElementById("room-tpl");
const tileTpl = document.getElementById("tile-tpl");

const tiles = new Map(); // device id -> { el, device, dragging }

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

function renderAll({ rooms, devices }) {
  roomsEl.replaceChildren();
  tiles.clear();
  for (const room of rooms) {
    const roomDevices = devices.filter((d) => d.room === room.id);
    if (roomDevices.length === 0) continue;
    const roomEl = roomTpl.content.firstElementChild.cloneNode(true);
    roomEl.querySelector(".room-name").textContent = room.name;
    const tilesEl = roomEl.querySelector(".tiles");
    for (const device of roomDevices) tilesEl.append(createTile(device));
    roomsEl.append(roomEl);
  }
  if (tiles.size === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = t("empty");
    roomsEl.append(empty);
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

async function send(id, body, entry) {
  entry.el.classList.add("is-pending");
  try {
    const res = await fetch(`api/devices/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  } catch (err) {
    console.error(err);
    entry.el.querySelector(".tile-status").textContent = t("error");
  } finally {
    entry.el.classList.remove("is-pending");
  }
}

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
    if (msg.type === "snapshot") renderAll(msg.data);
    else if (msg.type === "device") {
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
