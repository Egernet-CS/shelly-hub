import { EventEmitter } from "node:events";

// Talks to one Shelly Gen2+ component over the device's local WebSocket RPC (ws://<host>/rpc).
// Once a request has been sent on the socket, the device pushes NotifyStatus frames on it,
// so state changes (including physical switch presses) arrive without polling.

export type ComponentKind = "switch" | "light";

export interface ComponentState {
  online: boolean;
  on: boolean | null;
  brightness: number | null;
  power: number | null;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const RPC_TIMEOUT_MS = 5_000;
const KEEPALIVE_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export class ShellyComponent extends EventEmitter<{ change: [] }> {
  readonly host: string;
  readonly kind: ComponentKind;
  readonly componentId: number;
  readonly componentKey: string;
  state: ComponentState = { online: false, on: null, brightness: null, power: null };

  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private backoffMs = 1_000;
  private keepalive: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly src = `shelly-hub-${Math.random().toString(36).slice(2, 8)}`;

  constructor(host: string, component: string) {
    super();
    const [kind, id] = component.split(":");
    if (kind !== "switch" && kind !== "light") throw new Error(`Unsupported component: ${component}`);
    this.host = host;
    this.kind = kind;
    this.componentId = Number(id ?? 0);
    this.componentKey = component;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  async setOn(on: boolean): Promise<void> {
    await this.call(`${this.rpcPrefix}.Set`, { id: this.componentId, on });
  }

  async toggle(): Promise<void> {
    await this.call(`${this.rpcPrefix}.Toggle`, { id: this.componentId });
  }

  async setBrightness(brightness: number): Promise<void> {
    if (this.kind !== "light") throw new Error("Brightness is only supported on lights");
    const value = Math.min(100, Math.max(1, Math.round(brightness)));
    await this.call("Light.Set", { id: this.componentId, on: true, brightness: value });
  }

  private get rpcPrefix(): string {
    return this.kind === "light" ? "Light" : "Switch";
  }

  private connect(): void {
    const ws = new WebSocket(`ws://${this.host}/rpc`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoffMs = 1_000;
      this.refresh();
      this.keepalive = setInterval(() => this.refresh(), KEEPALIVE_MS);
    });

    ws.addEventListener("message", (event) => {
      this.handleMessage(String(event.data));
    });

    ws.addEventListener("close", () => this.handleClose(ws));
    ws.addEventListener("error", () => ws.close());
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
    this.update({ online: false });
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  // Fetches the component status; doubles as a keepalive that detects dead sockets.
  private refresh(): void {
    this.call(`${this.rpcPrefix}.GetStatus`, { id: this.componentId })
      .then((status) => this.applyStatus(status as Record<string, unknown>))
      .catch(() => this.ws?.close());
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
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
      const status = msg.params?.[this.componentKey];
      if (status) this.applyStatus(status);
    }
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
