import { EventEmitter } from "node:events";

// One WebSocket RPC connection per Shelly Gen2+ device (ws://<host>/rpc). Once a request has been
// sent on the socket, the device pushes NotifyStatus/NotifyEvent frames on it, so state changes
// (including physical switch presses and BLU button presses) arrive without polling.

export type ComponentKind = "switch" | "light";

export interface ComponentState {
  online: boolean;
  on: boolean | null;
  brightness: number | null;
  power: number | null;
}

export interface ShellyEvent {
  component: string;
  event: string;
  ts?: number;
  [key: string]: unknown;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const RPC_TIMEOUT_MS = 5_000;
const KEEPALIVE_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export class ShellyConnection extends EventEmitter<{
  online: [boolean];
  status: [Record<string, any>];
  event: [ShellyEvent];
}> {
  readonly shellyId: string;
  host: string;
  online = false;

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private backoffMs = 1_000;
  private keepalive: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private readonly src = `shelly-hub-${Math.random().toString(36).slice(2, 8)}`;

  constructor(shellyId: string, host: string) {
    super();
    this.shellyId = shellyId;
    this.host = host;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
  }

  // The device got a new address: drop the old socket and connect to the new one.
  setHost(host: string): void {
    if (host === this.host) return;
    this.host = host;
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.backoffMs = 1_000;
    if (this.ws) this.ws.close();
    else this.connect();
  }

  call<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`${this.host} is offline`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, RPC_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, src: this.src, method, params }));
    });
  }

  private connect(): void {
    const ws = new WebSocket(`ws://${this.host}/rpc`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoffMs = 1_000;
      this.refresh();
      this.keepalive = setInterval(() => this.refresh(), KEEPALIVE_MS);
    });

    ws.addEventListener("message", (event) => this.handleMessage(String(event.data)));

    // An error is always followed by a close event, so reconnecting is handled there.
    // (Calling close() from the error handler while connecting re-fires error and recurses.)
    ws.addEventListener("close", () => this.handleClose(ws));
  }

  private handleClose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Connection closed"));
      this.pending.delete(id);
    }
    this.setOnline(false);
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  // Full status refresh; doubles as a keepalive that detects dead sockets.
  refresh(): void {
    this.call<Record<string, any>>("Shelly.GetStatus")
      .then((status) => {
        this.setOnline(true);
        this.emit("status", status);
      })
      .catch(() => this.ws?.close());
  }

  private setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    this.emit("online", online);
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? "RPC error"));
      else p.resolve(msg.result);
      return;
    }

    if (msg.method === "NotifyStatus" || msg.method === "NotifyFullStatus") {
      if (msg.params) this.emit("status", msg.params);
    } else if (msg.method === "NotifyEvent") {
      for (const event of msg.params?.events ?? []) this.emit("event", event);
    }
  }
}

// One controllable channel (e.g. `switch:0`, `light:0`) on a connection.
export class ShellyComponent extends EventEmitter<{ change: [] }> {
  readonly connection: ShellyConnection;
  readonly kind: ComponentKind;
  readonly componentId: number;
  readonly componentKey: string;
  state: ComponentState = { online: false, on: null, brightness: null, power: null };

  private readonly onStatus = (status: Record<string, any>) => {
    const own = status[this.componentKey];
    if (own) this.applyStatus(own);
  };
  private readonly onOnline = (online: boolean) => this.update({ online });

  constructor(connection: ShellyConnection, component: string) {
    super();
    const [kind, id] = component.split(":");
    if (kind !== "switch" && kind !== "light") throw new Error(`Unsupported component: ${component}`);
    this.connection = connection;
    this.kind = kind;
    this.componentId = Number(id ?? 0);
    this.componentKey = component;
    connection.on("status", this.onStatus);
    connection.on("online", this.onOnline);
    // Added to a connection that's already up: fetch our state now instead of at the next keepalive.
    if (connection.online) connection.refresh();
  }

  detach(): void {
    this.connection.off("status", this.onStatus);
    this.connection.off("online", this.onOnline);
    this.removeAllListeners();
  }

  async setOn(on: boolean): Promise<void> {
    await this.connection.call(`${this.rpcPrefix}.Set`, { id: this.componentId, on });
  }

  async toggle(): Promise<void> {
    await this.connection.call(`${this.rpcPrefix}.Toggle`, { id: this.componentId });
  }

  async setBrightness(brightness: number): Promise<void> {
    if (this.kind !== "light") throw new Error("Brightness is only supported on lights");
    const value = Math.min(100, Math.max(1, Math.round(brightness)));
    await this.connection.call("Light.Set", { id: this.componentId, on: true, brightness: value });
  }

  private get rpcPrefix(): string {
    return this.kind === "light" ? "Light" : "Switch";
  }

  private applyStatus(status: Record<string, unknown>): void {
    const patch: Partial<ComponentState> = { online: true };
    if (typeof status.output === "boolean") patch.on = status.output;
    if (typeof status.brightness === "number") patch.brightness = status.brightness;
    if (typeof status.apower === "number") patch.power = status.apower;
    this.update(patch);
  }

  private update(patch: Partial<ComponentState>): void {
    const next = { ...this.state, ...patch };
    const changed = (Object.keys(next) as (keyof ComponentState)[]).some((k) => next[k] !== this.state[k]);
    this.state = next;
    if (changed) this.emit("change");
  }
}
