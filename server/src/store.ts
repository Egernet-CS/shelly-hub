import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface RoomConfig {
  id: string;
  name: string;
}

// One controllable channel on a Shelly, e.g. relay `switch:1` on a 2-channel device.
export interface DeviceConfig {
  id: string;
  shellyId: string;
  host: string;
  component: string;
  name: string;
  room: string | null;
}

export interface HomeConfig {
  rooms: RoomConfig[];
  devices: DeviceConfig[];
}

export function deviceId(shellyId: string, component: string): string {
  return `${shellyId}-${component.replace(":", "")}`;
}

// Persists the home config as JSON. Writes go to a temp file first so a crash never leaves
// a half-written config behind.
export class ConfigStore {
  readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
  }

  async load(): Promise<HomeConfig> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { rooms: [], devices: [] };
      throw err;
    }
    const config = JSON.parse(raw) as HomeConfig;
    let migrated = false;
    for (const device of config.devices) {
      // v0.1 configs used the Shelly id as the device id and had no shellyId field.
      if (!device.shellyId) {
        device.shellyId = device.id;
        device.id = deviceId(device.shellyId, device.component);
        migrated = true;
      }
      device.room ??= null;
    }
    if (migrated) await this.save(config);
    return config;
  }

  async save(config: HomeConfig): Promise<void> {
    await mkdir(path.dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
    await rename(tmp, this.path);
  }
}
