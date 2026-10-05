import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ShellyComponent, type ComponentKind } from "./shelly.ts";
import { ConfigStore, deviceId, type DeviceConfig, type HomeConfig, type RoomConfig } from "./store.ts";
import type { DiscoveredDevice } from "./discovery.ts";

export interface DeviceView {
  id: string;
  shellyId: string;
  host: string;
  component: string;
  name: string;
  room: string | null;
  kind: ComponentKind;
  online: boolean;
  on: boolean | null;
  brightness: number | null;
  power: number | null;
}

export interface HomeSnapshot {
  rooms: RoomConfig[];
  devices: DeviceView[];
}

export interface DeviceCommand {
  on?: boolean;
  toggle?: boolean;
  brightness?: number;
}

export interface NewDevice {
  shellyId: string;
  host: string;
  component: string;
  name: string;
  room: string | null;
}

export interface DevicePatch {
  name?: string;
  room?: string | null;
}

export class HomeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Entry {
  config: DeviceConfig;
  component: ShellyComponent;
}

// The home: rooms plus adopted device channels. Emits `device` for live state changes and
// `structure` when rooms/devices are added, changed or removed.
export class Home extends EventEmitter<{ device: [DeviceView]; structure: [] }> {
  private store: ConfigStore;
  private rooms: RoomConfig[] = [];
  private devices = new Map<string, Entry>();
  private running = false;

  private constructor(store: ConfigStore) {
    super();
    this.store = store;
  }

  static async load(configPath: string): Promise<Home> {
    const store = new ConfigStore(configPath);
    const config = await store.load();
    const home = new Home(store);
    home.rooms = config.rooms;
    for (const device of config.devices) home.attach(device);
    return home;
  }

  start(): void {
    this.running = true;
    for (const { component } of this.devices.values()) component.start();
  }

  stop(): void {
    this.running = false;
    for (const { component } of this.devices.values()) component.stop();
  }

  snapshot(): HomeSnapshot {
    return {
      rooms: this.rooms,
      devices: [...this.devices.keys()].map((id) => this.view(id)!),
    };
  }

  view(id: string): DeviceView | undefined {
    const entry = this.devices.get(id);
    if (!entry) return undefined;
    const { config, component } = entry;
    return { ...config, kind: component.kind, ...component.state };
  }

  async command(id: string, cmd: DeviceCommand): Promise<void> {
    const { component } = this.entry(id);
    if (typeof cmd.brightness === "number") await component.setBrightness(cmd.brightness);
    else if (typeof cmd.on === "boolean") await component.setOn(cmd.on);
    else if (cmd.toggle) await component.toggle();
    else throw new HomeError(400, "Empty command");
  }

  // ---- Devices ----

  async addDevice(input: NewDevice): Promise<DeviceView> {
    const id = deviceId(input.shellyId, input.component);
    if (this.devices.has(id)) throw new HomeError(409, "Device already added");
    this.assertRoom(input.room);
    const config: DeviceConfig = {
      id,
      shellyId: input.shellyId,
      host: input.host,
      component: input.component,
      name: cleanName(input.name),
      room: input.room,
    };
    this.attach(config);
    await this.persist();
    return this.view(id)!;
  }

  async updateDevice(id: string, patch: DevicePatch): Promise<DeviceView> {
    const { config } = this.entry(id);
    if (patch.name !== undefined) config.name = cleanName(patch.name);
    if (patch.room !== undefined) {
      this.assertRoom(patch.room);
      config.room = patch.room;
    }
    await this.persist();
    return this.view(id)!;
  }

  async removeDevice(id: string): Promise<void> {
    const { component } = this.entry(id);
    component.stop();
    component.removeAllListeners();
    this.devices.delete(id);
    await this.persist();
  }

  // Applies scan results to adopted devices: if a Shelly got a new IP, follow it.
  async updateHosts(found: DiscoveredDevice[]): Promise<void> {
    const hostById = new Map(found.map((d) => [d.shellyId, d.host]));
    let changed = false;
    for (const [id, entry] of this.devices) {
      const host = hostById.get(entry.config.shellyId);
      if (!host || host === entry.config.host) continue;
      entry.component.stop();
      entry.component.removeAllListeners();
      entry.config.host = host;
      this.devices.delete(id);
      this.attach(entry.config);
      changed = true;
    }
    if (changed) await this.persist();
  }

  isAdopted(shellyId: string, component: string): boolean {
    return this.devices.has(deviceId(shellyId, component));
  }

  // ---- Rooms ----

  async addRoom(name: string): Promise<RoomConfig> {
    const room = { id: randomUUID().slice(0, 8), name: cleanName(name) };
    this.rooms.push(room);
    await this.persist();
    return room;
  }

  async renameRoom(id: string, name: string): Promise<RoomConfig> {
    const room = this.rooms.find((r) => r.id === id);
    if (!room) throw new HomeError(404, "Unknown room");
    room.name = cleanName(name);
    await this.persist();
    return room;
  }

  // Devices in a deleted room are kept but become unassigned.
  async removeRoom(id: string): Promise<void> {
    const index = this.rooms.findIndex((r) => r.id === id);
    if (index === -1) throw new HomeError(404, "Unknown room");
    this.rooms.splice(index, 1);
    for (const { config } of this.devices.values()) {
      if (config.room === id) config.room = null;
    }
    await this.persist();
  }

  async moveRoom(id: string, direction: -1 | 1): Promise<void> {
    const index = this.rooms.findIndex((r) => r.id === id);
    if (index === -1) throw new HomeError(404, "Unknown room");
    const target = index + direction;
    if (target < 0 || target >= this.rooms.length) return;
    [this.rooms[index], this.rooms[target]] = [this.rooms[target]!, this.rooms[index]!];
    await this.persist();
  }

  // ---- Internals ----

  private attach(config: DeviceConfig): void {
    const component = new ShellyComponent(config.host, config.component);
    component.on("change", () => this.emit("device", this.view(config.id)!));
    this.devices.set(config.id, { config, component });
    if (this.running) component.start();
  }

  private entry(id: string): Entry {
    const entry = this.devices.get(id);
    if (!entry) throw new HomeError(404, "Unknown device");
    return entry;
  }

  private assertRoom(room: string | null): void {
    if (room !== null && !this.rooms.some((r) => r.id === room)) throw new HomeError(400, "Unknown room");
  }

  private async persist(): Promise<void> {
    const config: HomeConfig = {
      rooms: this.rooms,
      devices: [...this.devices.values()].map((e) => e.config),
    };
    await this.store.save(config);
    this.emit("structure");
  }
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new HomeError(400, "Name is required");
  return trimmed;
}
