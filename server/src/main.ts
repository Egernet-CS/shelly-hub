import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { Home, type DeviceCommand } from "./home.ts";

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

await app.register(fastifyWebsocket);
await app.register(fastifyStatic, { root: WEB_DIR });

app.get("/api/home", async () => home.snapshot());

app.post<{ Params: { id: string }; Body: DeviceCommand }>(
  "/api/devices/:id",
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
    if (!home.view(req.params.id)) return reply.code(404).send({ error: "Unknown device" });
    try {
      await home.command(req.params.id, req.body);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  },
);

app.get("/api/ws", { websocket: true }, (socket) => {
  socket.send(JSON.stringify({ type: "snapshot", data: home.snapshot() }));
});

home.on("device", (device) => {
  const msg = JSON.stringify({ type: "device", data: device });
  for (const client of app.websocketServer.clients) {
    if (client.readyState === client.OPEN) client.send(msg);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    home.stop();
    await app.close();
    process.exit(0);
  });
}

home.start();
await app.listen({ port: PORT, host: HOST });
