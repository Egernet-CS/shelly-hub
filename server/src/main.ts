import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { Home, HomeError, type DeviceCommand, type DevicePatch, type NewDevice } from "./home.ts";
import { DiscoveryService } from "./discovery.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? path.join(here, "../data");
const CONFIG = process.env.HOME_CONFIG ?? path.join(DATA_DIR, "home.json");
const WEB_DIR = process.env.WEB_DIR ?? path.join(here, "../../web");
// Requests arriving on these local addresses are refused. Use this when the hub has a leg on the
// IoT/guest network, so nobody on that network can control the house. Example: "192.168.50."
const DENY_LOCAL = (process.env.DENY_LOCAL_PREFIXES ?? "").split(",").filter(Boolean);

const home = await Home.load(CONFIG);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

app.addHook("onRequest", async (req, reply) => {
  const local = (req.socket.localAddress ?? "").replace(/^::ffff:/, "");
  if (DENY_LOCAL.some((prefix) => local.startsWith(prefix))) {
    return reply.code(403).send({ error: "Forbidden on this network" });
  }
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof HomeError) return reply.code(err.status).send({ error: err.message });
  if ((err as { validation?: unknown }).validation) return reply.code(400).send({ error: (err as Error).message });
  app.log.error(err);
  return reply.code(500).send({ error: "Internal error" });
});

await app.register(fastifyWebsocket);
await app.register(fastifyStatic, { root: WEB_DIR });

const name = { type: "string", minLength: 1, maxLength: 40 };
const roomRef = { type: ["string", "null"] };

// ---- Home & control ----

app.get("/api/home", async () => home.snapshot());

app.get("/api/blu", async () => home.bluDevices());

app.post<{ Params: { id: string }; Body: DeviceCommand }>(
  "/api/devices/:id/command",
  {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        properties: {
          on: { type: "boolean" },
          toggle: { type: "boolean" },
          brightness: { type: "number", minimum: 1, maximum: 100 },
        },
      },
    },
  },
  async (req, reply) => {
    if (!home.view(req.params.id)) throw new HomeError(404, "Unknown device");
    try {
      await home.command(req.params.id, req.body);
    } catch (err) {
      if (err instanceof HomeError) throw err;
      throw new HomeError(502, (err as Error).message);
    }
    return reply.code(204).send();
  },
);

// ---- Device setup ----

app.post<{ Body: NewDevice }>(
  "/api/devices",
  {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["shellyId", "host", "component", "name", "room"],
        properties: {
          shellyId: { type: "string", minLength: 1 },
          host: { type: "string", minLength: 1 },
          component: { type: "string", pattern: "^(switch|light):\\d+$" },
          name,
          room: roomRef,
        },
      },
    },
  },
  async (req, reply) => reply.code(201).send(await home.addDevice(req.body)),
);

app.patch<{ Params: { id: string }; Body: DevicePatch }>(
  "/api/devices/:id",
  {
    schema: {
      body: { type: "object", additionalProperties: false, properties: { name, room: roomRef } },
    },
  },
  async (req) => home.updateDevice(req.params.id, req.body),
);

app.delete<{ Params: { id: string } }>("/api/devices/:id", async (req, reply) => {
  await home.removeDevice(req.params.id);
  return reply.code(204).send();
});

// ---- Rooms ----

app.post<{ Body: { name: string } }>(
  "/api/rooms",
  { schema: { body: { type: "object", additionalProperties: false, required: ["name"], properties: { name } } } },
  async (req, reply) => reply.code(201).send(await home.addRoom(req.body.name)),
);

app.patch<{ Params: { id: string }; Body: { name: string } }>(
  "/api/rooms/:id",
  { schema: { body: { type: "object", additionalProperties: false, required: ["name"], properties: { name } } } },
  async (req) => home.renameRoom(req.params.id, req.body.name),
);

app.post<{ Params: { id: string }; Body: { direction: -1 | 1 } }>(
  "/api/rooms/:id/move",
  {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["direction"],
        properties: { direction: { enum: [-1, 1] } },
      },
    },
  },
  async (req, reply) => {
    await home.moveRoom(req.params.id, req.body.direction);
    return reply.code(204).send();
  },
);

app.delete<{ Params: { id: string } }>("/api/rooms/:id", async (req, reply) => {
  await home.removeRoom(req.params.id);
  return reply.code(204).send();
});

// ---- Discovery ----

const discovery = new DiscoveryService();

async function runScan(): Promise<void> {
  const found = await discovery.scan();
  await home.updateHosts(found);
}

// Scan results, with each channel marked as already added or not.
function discoveryView() {
  return {
    scanning: discovery.scanning,
    lastScan: discovery.lastScan,
    devices: discovery.devices.map((d) => ({
      ...d,
      components: d.components.map((c) => ({ ...c, added: home.isAdopted(d.shellyId, c.key) })),
    })),
  };
}

app.get("/api/discovery", async () => discoveryView());

// Starts a scan of the hub's networks (or probes one host when `host` is given) and returns
// the result. Results are also pushed to all apps as `discovery` messages.
app.post<{ Body: { host?: string } }>(
  "/api/discovery/scan",
  {
    schema: {
      body: {
        type: ["object", "null"],
        additionalProperties: false,
        properties: { host: { type: "string", pattern: "^[A-Za-z0-9.-]{1,253}$" } },
      },
    },
  },
  async (req) => {
    if (req.body?.host) {
      const device = await discovery.probeHost(req.body.host);
      if (device) await home.updateHosts([device]);
      return { ...discoveryView(), found: device ? device.shellyId : null };
    }
    await runScan();
    return discoveryView();
  },
);

// Keep looking for new devices (and devices that got a new IP) in the background.
const SCAN_INTERVAL_MS = 5 * 60_000;
const backgroundScan = () => runScan().catch((err) => app.log.warn({ err }, "background scan failed"));
setTimeout(backgroundScan, 5_000).unref();
setInterval(backgroundScan, SCAN_INTERVAL_MS).unref();

// ---- Live updates ----

app.get("/api/ws", { websocket: true }, (socket) => {
  socket.send(JSON.stringify({ type: "snapshot", data: home.snapshot() }));
  socket.send(JSON.stringify({ type: "discovery", data: discoveryView() }));
});

function broadcast(msg: unknown): void {
  const text = JSON.stringify(msg);
  for (const client of app.websocketServer.clients) {
    if (client.readyState === client.OPEN) client.send(text);
  }
}

home.on("device", (device) => broadcast({ type: "device", data: device }));
home.on("structure", () => {
  broadcast({ type: "snapshot", data: home.snapshot() });
  broadcast({ type: "discovery", data: discoveryView() });
});
discovery.on("update", () => broadcast({ type: "discovery", data: discoveryView() }));
home.on("blu", () => broadcast({ type: "blu", data: home.bluDevices() }));
home.on("bluPress", (addr, press) => broadcast({ type: "bluPress", data: { addr, ...press } }));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    home.stop();
    await app.close();
    process.exit(0);
  });
}

home.start();
await app.listen({ port: PORT, host: HOST });
