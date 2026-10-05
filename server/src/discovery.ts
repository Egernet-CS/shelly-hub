import { networkInterfaces } from "node:os";

// Finds Shelly devices by probing `http://<ip>/shelly` on every host of the hub's own IPv4
// networks (each capped to its /24). Slower than mDNS but works across setups where multicast
// is filtered, and needs no extra dependencies.

export interface DiscoveredComponent {
  key: string; // e.g. "switch:0"
  kind: "switch" | "light";
}

export interface DiscoveredDevice {
  shellyId: string;
  host: string;
  model: string;
  app: string;
  gen: number;
  name: string | null;
  supported: boolean;
  components: DiscoveredComponent[];
}

const PROBE_TIMEOUT_MS = 1_500;
const CONCURRENCY = 64;
const SUPPORTED_COMPONENT = /^(switch|light):\d+$/;

export function scanTargets(): string[] {
  const own = new Set<string>();
  const targets = new Set<string>();
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      own.add(addr.address);
      const prefix = addr.address.split(".").slice(0, 3).join(".");
      for (let i = 1; i < 255; i++) targets.add(`${prefix}.${i}`);
    }
  }
  for (const ip of own) targets.delete(ip);
  return [...targets];
}

export async function probe(host: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<DiscoveredDevice | null> {
  const info = await getJson(`http://${host}/shelly`, timeoutMs);
  if (!info || (typeof info.id !== "string" && typeof info.mac !== "string")) return null;

  const gen = typeof info.gen === "number" ? info.gen : 1;
  const device: DiscoveredDevice = {
    shellyId: String(info.id ?? `shelly-${info.mac}`).toLowerCase(),
    host,
    model: String(info.model ?? info.type ?? "unknown"),
    app: String(info.app ?? info.type ?? "Shelly"),
    gen,
    name: typeof info.name === "string" && info.name ? info.name : null,
    supported: gen >= 2,
    components: [],
  };
  if (!device.supported) return device;

  const status = await getJson(`http://${host}/rpc/Shelly.GetStatus`, 3_000);
  for (const key of Object.keys(status ?? {}).sort()) {
    if (SUPPORTED_COMPONENT.test(key)) {
      device.components.push({ key, kind: key.split(":")[0] as DiscoveredComponent["kind"] });
    }
  }
  return device;
}

export async function scan(targets = scanTargets()): Promise<DiscoveredDevice[]> {
  const found: DiscoveredDevice[] = [];
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const device = await probe(targets[next++]!);
      if (device) found.push(device);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

async function getJson(url: string, timeoutMs: number): Promise<Record<string, any> | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}
