import { EventEmitter } from "node:events";
import type { ShellyConnection, ShellyEvent } from "./shelly.ts";

// Shelly BLU devices (wall switches, buttons, sensors) speak BTHome v2 over Bluetooth. The hub has
// no radio: Shelly Gen3/Gen4 devices act as gateways. A BLU device is either
//  - paired locally: a `bthomedevice:<n>` component on the gateway (status + button events pushed), or
//  - relayed to Shelly Cloud: listed by `BLE.CloudRelay.ListInfos` (only works with internet).

export type BluKind = "switch4" | "button" | "contact" | "motion" | "sensor" | "unknown";
export type BluMode = "local" | "cloud";

export interface BluPress {
  button: number; // 1-based
  event: string; // single_push, double_push, long_push, ...
  ts: number; // unix seconds
}

export interface BluEntry {
  addr: string;
  name: string | null;
  mode: BluMode;
  componentKey: string | null;
  kind: BluKind;
  buttons: number | null;
  battery: number | null;
  rssi: number | null;
  lastSeen: number | null; // unix seconds
  lastPress: BluPress | null;
}

// ---- BTHome v2 decoding ----

export interface BthomeData {
  encrypted: boolean;
  battery?: number;
  buttons: number[]; // event code per button: 0 none, 1 press, 2 double, 3 triple, 4 long, ...
  temperature?: number;
  humidity?: number;
  illuminance?: number;
  open?: boolean;
  motion?: boolean;
}

// Data length per BTHome object id (bytes after the id). Unknown ids stop decoding.
const OBJECT_LENGTH: Record<number, number> = {
  0x00: 1, 0x01: 1, 0x02: 2, 0x03: 2, 0x04: 3, 0x05: 3, 0x06: 2, 0x07: 2, 0x08: 2, 0x09: 1,
  0x0a: 3, 0x0b: 3, 0x0c: 2, 0x0d: 2, 0x0e: 2, 0x12: 2, 0x13: 2, 0x14: 2,
  0x2e: 1, 0x2f: 1, 0x3a: 1, 0x3c: 2, 0x3d: 2, 0x3e: 4, 0x3f: 2, 0x40: 2, 0x41: 2, 0x42: 3,
  0x43: 2, 0x44: 2, 0x45: 2, 0x46: 1, 0xf0: 2, 0xf1: 4, 0xf2: 3,
};
for (let id = 0x0f; id <= 0x2d; id++) OBJECT_LENGTH[id] ??= 1; // binary sensors

export function decodeBthome(data: Buffer): BthomeData {
  const out: BthomeData = { encrypted: false, buttons: [] };
  if (data.length === 0) return out;
  out.encrypted = (data[0]! & 0x01) === 1;
  if (out.encrypted) return out;
  let i = 1;
  while (i < data.length) {
    const id = data[i]!;
    const len = OBJECT_LENGTH[id];
    if (len === undefined || i + 1 + len > data.length) break;
    const v = data.subarray(i + 1, i + 1 + len);
    switch (id) {
      case 0x01: out.battery = v[0]; break;
      case 0x02: out.temperature = v.readInt16LE(0) / 100; break;
      case 0x45: out.temperature = v.readInt16LE(0) / 10; break;
      case 0x03: out.humidity = v.readUInt16LE(0) / 100; break;
      case 0x2e: out.humidity = v[0]; break;
      case 0x05: out.illuminance = v.readUIntLE(0, 3) / 100; break;
      case 0x1a: case 0x2d: case 0x11: out.open = v[0] === 1; break;
      case 0x21: out.motion = v[0] === 1; break;
      case 0x3a: out.buttons.push(v[0]!); break;
    }
    i += 1 + len;
  }
  return out;
}

export function kindFor(data: { buttons: number | null; open?: boolean; motion?: boolean; temperature?: number }): BluKind {
  if (data.buttons === 4) return "switch4";
  if (data.buttons && data.buttons > 0) return "button";
  if (data.open !== undefined) return "contact";
  if (data.motion !== undefined) return "motion";
  if (data.temperature !== undefined) return "sensor";
  return "unknown";
}

const PRESS_EVENTS = new Set([
  "single_push", "double_push", "triple_push", "long_push", "long_double_push", "long_triple_push",
]);
const REFRESH_MS = 60_000;

// Tracks the BLU devices one Shelly knows about (as local gateway or cloud relay).
export class BluTracker extends EventEmitter<{ change: []; press: [string, BluPress] }> {
  readonly connection: ShellyConnection;
  entries = new Map<string, BluEntry>();
  private byComponent = new Map<string, string>(); // "bthomedevice:200" -> addr
  private timer: NodeJS.Timeout | null = null;

  private readonly onOnline = (online: boolean) => {
    if (online) this.refresh();
  };
  private readonly onStatus = (status: Record<string, any>) => this.applyStatus(status);
  private readonly onEvent = (event: ShellyEvent) => this.applyEvent(event);

  constructor(connection: ShellyConnection) {
    super();
    this.connection = connection;
    connection.on("online", this.onOnline);
    connection.on("status", this.onStatus);
    connection.on("event", this.onEvent);
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    if (connection.online) this.refresh();
  }

  detach(): void {
    if (this.timer) clearInterval(this.timer);
    this.connection.off("online", this.onOnline);
    this.connection.off("status", this.onStatus);
    this.connection.off("event", this.onEvent);
    this.removeAllListeners();
  }

  async refresh(): Promise<void> {
    if (!this.connection.online) return;
    const next = new Map<string, BluEntry>();
    const byComponent = new Map<string, string>();

    try {
      for (const c of await this.dynamicComponents()) {
        if (!/^bthomedevice:\d+$/.test(c.key)) continue;
        const addr = String(c.config?.addr ?? "").toLowerCase();
        if (!addr) continue;
        const buttons = await this.buttonCount(c.config.id);
        byComponent.set(c.key, addr);
        next.set(addr, {
          addr,
          name: c.config.name ?? null,
          mode: "local",
          componentKey: c.key,
          kind: kindFor({ buttons }),
          buttons,
          battery: numberOrNull(c.status?.battery),
          rssi: numberOrNull(c.status?.rssi),
          lastSeen: numberOrNull(c.status?.last_updated_ts),
          lastPress: this.entries.get(addr)?.lastPress ?? null,
        });
      }
    } catch {
      return; // connection hiccup: keep what we had
    }

    try {
      const infos = await this.connection.call("BLE.CloudRelay.ListInfos");
      for (const item of infos?.devices ?? []) {
        for (const [rawAddr, info] of Object.entries<any>(item)) {
          const addr = rawAddr.toLowerCase();
          if (next.has(addr)) continue; // paired locally wins
          const data = info?.sdata?.fcd2 ? decodeBthome(Buffer.from(info.sdata.fcd2, "base64")) : null;
          const buttons = data && data.buttons.length > 0 ? data.buttons.length : null;
          next.set(addr, {
            addr,
            name: info?.name ?? null,
            mode: "cloud",
            componentKey: null,
            kind: data ? kindFor({ ...data, buttons }) : "unknown",
            buttons,
            battery: data?.battery ?? null,
            rssi: null,
            lastSeen: numberOrNull(info?.last_seen),
            lastPress: null,
          });
        }
      }
    } catch {
      // Older firmware without cloud relay support.
    }

    const changed = JSON.stringify([...next.values()]) !== JSON.stringify([...this.entries.values()]);
    this.entries = next;
    this.byComponent = byComponent;
    if (changed) this.emit("change");
  }

  private async dynamicComponents(): Promise<any[]> {
    const all: any[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.connection.call("Shelly.GetComponents", {
        dynamic_only: true,
        include: ["config", "status"],
        offset,
      });
      const items: any[] = page?.components ?? [];
      all.push(...items);
      offset += items.length;
      if (items.length === 0 || offset >= (page?.total ?? 0)) return all;
    }
  }

  private async buttonCount(id: number): Promise<number | null> {
    try {
      const res = await this.connection.call("BTHomeDevice.GetKnownObjects", { id });
      const buttons = (res?.objects ?? []).filter((o: any) => o.obj_id === 0x3a).length;
      return buttons > 0 ? buttons : null;
    } catch {
      return null;
    }
  }

  private applyStatus(status: Record<string, any>): void {
    let changed = false;
    for (const [key, value] of Object.entries(status)) {
      const addr = this.byComponent.get(key);
      const entry = addr ? this.entries.get(addr) : undefined;
      if (!entry || typeof value !== "object" || value === null) continue;
      if (typeof value.battery === "number") entry.battery = value.battery;
      if (typeof value.rssi === "number") entry.rssi = value.rssi;
      if (typeof value.last_updated_ts === "number") entry.lastSeen = value.last_updated_ts;
      changed = true;
    }
    if (changed) this.emit("change");
  }

  private applyEvent(event: ShellyEvent): void {
    const addr = this.byComponent.get(event.component);
    const entry = addr ? this.entries.get(addr) : undefined;
    if (!entry || !PRESS_EVENTS.has(event.event)) return;
    const idx = typeof event.idx === "number" ? event.idx : 0;
    entry.lastPress = { button: idx + 1, event: event.event, ts: event.ts ?? Math.floor(Date.now() / 1000) };
    entry.lastSeen = entry.lastPress.ts;
    this.emit("press", entry.addr, entry.lastPress);
    this.emit("change");
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
