import { api } from "./api.js";
import { h, confirmButton } from "./dom.js";
import { ago, t } from "./i18n.js";

// Settings view: find and add devices, manage rooms, rename/move/remove devices.

const APP_NAMES = {
  Mini1G3: "Shelly 1 Mini",
  Mini1G4: "Shelly 1 Mini",
  Mini1PMG3: "Shelly 1PM Mini",
  Mini1PMG4: "Shelly 1PM Mini",
  DimmerG3: "Shelly Dimmer",
  DimmerG4: "Shelly Dimmer",
  Plus1: "Shelly Plus 1",
  Plus1PM: "Shelly Plus 1PM",
  Plus2PM: "Shelly Plus 2PM",
  PlusPlugS: "Shelly Plug S",
  PlusWallDimmer: "Shelly Wall Dimmer",
  Pro1: "Shelly Pro 1",
  Pro1PM: "Shelly Pro 1PM",
  Pro2: "Shelly Pro 2",
  Pro2PM: "Shelly Pro 2PM",
  Pro4PM: "Shelly Pro 4PM",
};

export function createSettings(root, { status }) {
  let home = { rooms: [], devices: [] };
  let discovery = { scanning: false, lastScan: null, devices: [] };
  let blu = [];
  let manualMessage = null;
  let renderPending = false;

  const findEl = h("section", { class: "panel" });
  const roomsEl = h("section", { class: "panel" });
  const devicesEl = h("section", { class: "panel" });
  const bluEl = h("section", { class: "panel" });
  root.replaceChildren(findEl, roomsEl, devicesEl, bluEl);

  // Don't rebuild a section while the user is typing in it; catch up when focus leaves.
  root.addEventListener("focusout", () => {
    setTimeout(() => {
      if (renderPending && !isEditing()) render();
    });
  });

  function isEditing() {
    const el = document.activeElement;
    return root.contains(el) && (el.tagName === "INPUT" || el.tagName === "SELECT");
  }

  async function run(action) {
    try {
      await action();
    } catch (err) {
      status(t("saveError", { error: err.message }));
    }
  }

  function roomOptions(selected) {
    return [
      h("option", { value: "", selected: selected == null }, t("noRoom")),
      ...home.rooms.map((r) => h("option", { value: r.id, selected: r.id === selected }, r.name)),
    ];
  }

  // ---- Find devices ----

  function defaultName(device, component) {
    const base = device.name ?? APP_NAMES[device.app] ?? `Shelly ${device.app}`;
    if (device.components.length === 1) return base;
    return `${base} ${Number(component.key.split(":")[1]) + 1}`;
  }

  // Devices the hub has found that still have channels to add (or that we can't support).
  function newDevices() {
    return discovery.devices.filter((d) => !d.supported || d.components.some((c) => !c.added));
  }

  function renderFind() {
    const found = newDevices();
    let body;
    if (found.length > 0) body = h("ul", { class: "found" }, found.map(renderFound));
    else if (discovery.scanning) body = h("p", { class: "hint searching" }, t("searching"));
    else body = h("p", { class: "hint" }, t("noNewDevices"));

    const footer = h("div", { class: "find-footer" },
      discovery.scanning && found.length > 0 ? h("span", { class: "muted searching" }, t("searching")) : null,
      discovery.scanning ? null : h("button", { type: "button", class: "btn-link", onclick: () => search() }, t("searchAgain")),
    );

    const ipInput = h("input", { type: "text", inputMode: "decimal", placeholder: t("ipPlaceholder"), autocomplete: "off", "aria-label": t("ipAddress") });
    const manual = h("details", { class: "manual", open: manualMessage != null },
      h("summary", {}, t("cantFind")),
      h("p", { class: "hint" }, t("addByIpHint")),
      h("form", {
        class: "inline-form",
        onsubmit: (e) => {
          e.preventDefault();
          const host = ipInput.value.trim();
          if (host) probeHost(host);
        },
      }, ipInput, h("button", { type: "submit", class: "btn" }, t("add"))),
      manualMessage ? h("p", { class: "hint" }, manualMessage) : null,
    );

    findEl.replaceChildren(h("h2", {}, t("newDevices")), body, footer, manual);
  }

  function renderFound(device) {
    const title = h("div", { class: "found-title" },
      h("strong", {}, device.name ?? APP_NAMES[device.app] ?? `Shelly ${device.app}`),
      h("span", { class: "muted" }, device.host),
    );
    let body;
    if (!device.supported) body = h("p", { class: "hint" }, t("notSupported"));
    else if (device.components.length === 0) body = h("p", { class: "hint" }, t("noChannels"));
    else if (device.components.every((c) => c.added)) body = h("p", { class: "hint ok" }, `✓ ${t("allAdded")}`);
    else body = device.components.map((c) => renderComponent(device, c));
    return h("li", { class: "found-item" }, title, body);
  }

  function renderComponent(device, component) {
    const kind = component.kind === "light" ? t("kindLight") : t("kindSwitch");
    const label = device.components.length > 1
      ? `${kind} · ${t("channel", { n: Number(component.key.split(":")[1]) + 1 })}`
      : kind;
    if (component.added) {
      return h("div", { class: "row" }, h("span", { class: "muted" }, label), h("span", { class: "ok" }, `✓ ${t("added")}`));
    }
    const nameInput = h("input", { type: "text", value: defaultName(device, component), maxLength: 40, "aria-label": t("name") });
    const roomSelect = h("select", { "aria-label": t("room") }, roomOptions(home.rooms[0]?.id ?? null));
    return h("form", {
      class: "row add-row",
      onsubmit: (e) => {
        e.preventDefault();
        run(async () => {
          await api.addDevice({
            shellyId: device.shellyId,
            host: device.host,
            component: component.key,
            name: nameInput.value,
            room: roomSelect.value || null,
          });
        });
      },
    },
      h("span", { class: "muted row-label" }, label),
      nameInput,
      roomSelect,
      h("button", { type: "submit", class: "btn btn-primary" }, t("add")),
    );
  }

  function search() {
    api.scan().catch((err) => status(t("saveError", { error: err.message })));
  }

  async function probeHost(host) {
    manualMessage = null;
    try {
      const result = await api.scan(host);
      manualMessage = result.found ? null : t("notFoundAt", { host });
    } catch (err) {
      manualMessage = t("saveError", { error: err.message });
    }
    renderFind();
  }

  // ---- Rooms ----

  function renderRooms() {
    const newRoom = h("input", { type: "text", placeholder: t("newRoom"), maxLength: 40, "aria-label": t("newRoom") });
    roomsEl.replaceChildren(
      h("h2", {}, t("rooms")),
      h("ul", { class: "list" }, home.rooms.map((room, i) => {
        const input = h("input", {
          type: "text",
          value: room.name,
          maxLength: 40,
          "aria-label": t("name"),
          onchange: () => run(() => api.renameRoom(room.id, input.value)),
        });
        return h("li", { class: "row" },
          input,
          h("button", { type: "button", class: "btn btn-icon", disabled: i === 0, "aria-label": t("moveUp"), onclick: () => run(() => api.moveRoom(room.id, -1)) }, "↑"),
          h("button", { type: "button", class: "btn btn-icon", disabled: i === home.rooms.length - 1, "aria-label": t("moveDown"), onclick: () => run(() => api.moveRoom(room.id, 1)) }, "↓"),
          confirmButton(t("delete"), t("confirm"), () => run(() => api.removeRoom(room.id))),
        );
      })),
      h("form", {
        class: "inline-form",
        onsubmit: (e) => {
          e.preventDefault();
          if (newRoom.value.trim()) run(() => api.addRoom(newRoom.value));
        },
      }, newRoom, h("button", { type: "submit", class: "btn" }, t("addRoom"))),
    );
  }

  // ---- Devices ----

  function renderDevices() {
    devicesEl.replaceChildren(
      h("h2", {}, t("devices")),
      home.devices.length === 0
        ? h("p", { class: "hint" }, t("noDevices"))
        : h("ul", { class: "list" }, home.devices.map((device) => {
            const input = h("input", {
              type: "text",
              value: device.name,
              maxLength: 40,
              "aria-label": t("name"),
              onchange: () => run(() => api.updateDevice(device.id, { name: input.value })),
            });
            const select = h("select", {
              "aria-label": t("room"),
              onchange: () => run(() => api.updateDevice(device.id, { room: select.value || null })),
            }, roomOptions(device.room));
            return h("li", { class: "row" },
              h("span", { class: `dot ${device.online ? "dot-on" : ""}`, title: device.online ? "" : t("offline") }),
              input,
              select,
              confirmButton(t("remove"), t("confirm"), () => run(() => api.removeDevice(device.id))),
            );
          })),
    );
  }

  // ---- BLU (Bluetooth) devices ----

  function signalLabel(rssi) {
    if (rssi >= -70) return t("signalGood");
    if (rssi >= -85) return t("signalOk");
    return t("signalWeak");
  }

  function renderBlu() {
    bluEl.replaceChildren(
      h("h2", {}, t("bluDevices")),
      h("p", { class: "hint" }, t("bluHint")),
      blu.length === 0
        ? h("p", { class: "hint" }, t("noBlu"))
        : h("ul", { class: "list" }, blu.map((d) => {
            const facts = [
              d.battery != null ? t("battery", { value: d.battery }) : null,
              d.rssi != null ? `${t("signal")}: ${signalLabel(d.rssi)}` : null,
              d.lastSeen ? t("lastSeen", { time: ago(d.lastSeen) }) : null,
            ].filter(Boolean);
            return h("li", { class: "blu-item" },
              h("div", { class: "found-title" },
                h("strong", {}, d.name ?? t(`kind_${d.kind}`)),
                h("span", { class: "muted mono" }, d.addr.slice(-5)),
              ),
              d.name ? h("div", { class: "muted" }, t(`kind_${d.kind}`)) : null,
              h("div", {},
                t("pairedWith", { name: d.gateway.name }),
                " · ",
                d.mode === "cloud" ? h("span", { class: "warn" }, t("viaCloud")) : h("span", { class: "ok" }, t("local")),
              ),
              facts.length ? h("div", { class: "muted" }, facts.join(" · ")) : null,
              d.lastPress
                ? h("div", { class: "muted" }, t("lastPress", {
                    button: d.lastPress.button,
                    event: t(`ev_${d.lastPress.event}`),
                    time: ago(d.lastPress.ts),
                  }))
                : null,
            );
          })),
    );
  }

  function render() {
    renderPending = false;
    renderFind();
    renderRooms();
    renderDevices();
    renderBlu();
  }

  function scheduleRender() {
    if (isEditing()) renderPending = true;
    else render();
  }

  return {
    update(snapshot) {
      home = snapshot;
      scheduleRender();
    },
    updateBlu(list) {
      blu = list;
      renderBlu(); // no inputs in this section, safe to redraw while typing elsewhere
    },
    bluPress({ addr, ...press }) {
      const device = blu.find((d) => d.addr === addr);
      if (!device) return;
      device.lastPress = press;
      device.lastSeen = press.ts;
      renderBlu();
    },
    updateDiscovery(state) {
      discovery = state;
      scheduleRender();
    },
    // Called when settings opens: look for new devices right away.
    opened() {
      if (!discovery.scanning) search();
    },
  };
}
