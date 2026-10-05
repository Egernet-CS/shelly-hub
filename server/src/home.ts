import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { ShellyComponent, type ComponentKind } from "./shelly.ts";

interface RoomConfig {
  id: string;
  name: string;
}

interface DeviceConfig {
  id: string;
  host: string;
  component: string;
  name: string;
  room: string;
}

interface HomeConfig {
  rooms: RoomConfig[];
  devices: DeviceConfig[];
}

export interface DeviceView {
  id: string;
  name: string;
  room: string;
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

export class Home extends EventEmitter<{ device: [DeviceView] }> {
  private rooms: RoomConfig[] = [];
  private devices = new Map<string, { config: DeviceConfig; component: ShellyComponent }>();

  // A missing config file means a fresh install: start with an empty home.
  static async load(path: string): Promise<Home> {
    let config: HomeConfig = { rooms: [], devices: [] };
    try {
      config = JSON.parse(await readFile(path, "utf8")) as HomeConfig;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const home = new Home();
    home.rooms = config.rooms;
    for (const device of config.devices) {
      const component = new ShellyComponent(device.host, device.component);
      home.devices.set(device.id, { config: device, component });
      component.on("change", () => home.emit("device", home.view(device.id)!));
    }
    return home;
  }

  start(): void {
    for (const { component } of this.devices.values()) component.start();
  }

  stop(): void {
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
    return {
      id: config.id,
      name: config.name,
      room: config.room,
      kind: component.kind,
      ...component.state,
    };
  }

  async command(id: string, cmd: DeviceCommand): Promise<void> {
    const entry = this.devices.get(id);
    if (!entry) throw new Error(`Unknown device: ${id}`);
    const { component } = entry;
    if (typeof cmd.brightness === "number") await component.setBrightness(cmd.brightness);
    else if (typeof cmd.on === "boolean") await component.setOn(cmd.on);
    else if (cmd.toggle) await component.toggle();
    else throw new Error("Empty command");
  }
}
