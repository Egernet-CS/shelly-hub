import { api } from "./api.js";
import { h, confirmButton } from "./dom.js";
import { t } from "./i18n.js";

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
  let scanResult = null; // null = not searched yet
  let scanning = false;
  let renderPending = false;

  const findEl = h("section", { class: "panel" });
  const roomsEl = h("section", { class: "panel" });
  const devicesEl = h("section", { class: "panel" });
  root.replaceChildren(findEl, roomsEl, devicesEl);

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

  function renderFind() {
    const searchButton = h("button", {
      type: "button",
      class: "btn btn-primary",
      disabled: scanning,
      onclick: () => search(),
    }, scanning ? t("searching") : t("search"));

    const ipInput = h("input", { type: "text", inputMode: "decimal", placeholder: t("ipPlaceholder"), autocomplete: "off" });
    const ipForm = h("form", {
      class: "inline-form",
      onsubmit: (e) => {
        e.preventDefault();
        if (ipInput.value.trim()) search(ipInput.value.trim());
      },
    }, ipInput, h("button", { type: "submit", class: "btn", disabled: scanning }, t("add")));

    findEl.replaceChildren(
      h("h2", {}, t("findDevices")),
      h("p", { class: "hint" }, t("findHint")),
      searchButton,
      h("p", { class: "label" }, t("addByIp")),
      ipForm,
      renderScanResult(),
    );
  }

  function renderScanResult() {
    if (!scanResult) return null;
    if (scanResult.devices.length === 0) {
      return h("p", { class: "hint" }, scanResult.host ? t("notFoundAt", { host: scanResult.host }) : t("noneFound"));
    }
    return h("ul", { class: "found" }, scanResult.devices.map(renderFound));
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
          component.added = true;
          renderFind();
        });
      },
    },
      h("span", { class: "muted row-label" }, label),
      nameInput,
      roomSelect,
      h("button", { type: "submit", class: "btn btn-primary" }, t("add")),
    );
  }

  async function search(host) {
    scanning = true;
    renderFind();
    try {
      const result = await api.scan(host);
      scanResult = { ...result, host };
    } catch (err) {
      status(t("saveError", { error: err.message }));
    } finally {
      scanning = false;
      renderFind();
    }
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

  function render() {
    renderPending = false;
    renderFind();
    renderRooms();
    renderDevices();
  }

  return {
    update(snapshot) {
      home = snapshot;
      if (isEditing()) renderPending = true;
      else render();
    },
  };
}
