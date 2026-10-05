# Simple

An easy, local-only way to use your Shelly smart home devices – no cloud, no engineering-style
settings screens. Just your rooms and your lights.

A small hub on your home network keeps a live connection to every Shelly and serves a clean app
for phones, tablets and desktops. State changes – including someone flipping a physical switch –
show up instantly on every screen.

> **Status:** early development. Works today for Shelly Gen2+ relays and dimmers. Native iOS
> and Android apps are planned. See [PLAN.md](PLAN.md).

## Features

- Rooms with big tap targets: on/off and dimming
- Setup in the app: search the network for Shellys, add them, name them, put them in rooms
- Follows devices that get a new IP address
- Live status and power usage, pushed from the devices (no polling)
- Works completely offline – nothing leaves your house
- Multilingual (English, Danish – more welcome)
- Optional: refuse requests arriving via your IoT/guest network, so guests can't control the house
- No build step: Node 24 runs the TypeScript hub directly; the web app is plain HTML/CSS/JS

## Quick start

Requires Node.js 22.18+ (24 recommended) and Shelly Gen2+ devices on a network the hub can reach.

```sh
cd server
npm install
PORT=8080 node src/main.ts     # open http://localhost:8080 and tap "Set up"
```

The hub must be on (or have an address in) the network your Shellys are on – it searches
the /24 of each of its own network interfaces. Everything you set up in the app is saved in
`data/home.json`, which you can also edit by hand:

```json
{
  "rooms": [{ "id": "living-room", "name": "Living room" }],
  "devices": [
    { "id": "shellydimmerg4-aabbccddeeff", "host": "192.168.1.50", "component": "light:0",
      "name": "Ceiling light", "room": "living-room" }
  ]
}
```

Supported components so far: `switch:<n>` and `light:<n>`.

| Environment variable | Default | |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | where the hub listens |
| `DATA_DIR` | `server/data` | config and state |
| `HOME_CONFIG` | `$DATA_DIR/home.json` | override config path |
| `DENY_LOCAL_PREFIXES` | – | comma-separated local address prefixes to refuse, e.g. `192.168.50.` |
| `LOG_LEVEL` | `info` | |

## Running as a service (Debian / Raspberry Pi OS)

```sh
ssh root@<host> 'bash -s v24.21.0' < deploy/setup-host.sh   # Node 24, avahi, service user
deploy/deploy.sh root@<host>                                # copy app, install, start
```

The service reads `/var/lib/shelly-hub/home.json` and optional settings from `/etc/shelly-hub.env`.

## API

| | |
|---|---|
| `GET /api/home` | rooms + devices with current state |
| `POST /api/devices/:id/command` | `{ "on": true }`, `{ "toggle": true }` or `{ "brightness": 1–100 }` |
| `POST /api/devices` | add a channel: `{ shellyId, host, component, name, room }` |
| `PATCH /api/devices/:id` | `{ name?, room? }` |
| `DELETE /api/devices/:id` | remove a channel |
| `POST /api/rooms` · `PATCH /api/rooms/:id` · `DELETE /api/rooms/:id` | `{ name }` |
| `POST /api/rooms/:id/move` | `{ "direction": -1 \| 1 }` |
| `POST /api/discovery/scan` | `{}` to search the network, `{ "host": "…" }` to probe one address |
| `WS /api/ws` | `snapshot` on connect and after any setup change, `device` on state changes |

## Translations

All UI text lives in [`web/i18n.js`](web/i18n.js). To add a language, copy the `en` block,
translate it and open a pull request.

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md) – free to use, modify and share for personal and
other noncommercial purposes. For commercial use, contact the author for a license.

Not affiliated with or endorsed by Shelly Group. "Shelly" is a trademark of its owner.
