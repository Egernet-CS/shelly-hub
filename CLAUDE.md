# Simple (shelly-hub)

**Simple** is an easy, local-only way to use Shelly smart home devices – a non-technical
alternative to the official app. Public repo (PolyForm Noncommercial); the author publishes
native iOS and Android apps in the stores, and people run the hub from this repo.
Roadmap: `PLAN.md`.

## Layout

- `server/` – the hub. Node 24 + TypeScript (run directly via Node type stripping, no build), Fastify.
  - `src/shelly.ts` – one Shelly Gen2+ component over the device's WebSocket RPC (`ws://<ip>/rpc`);
    push updates via `NotifyStatus`, keepalive + reconnect.
  - `src/home.ts` – rooms + adopted device channels; mutations persist and emit `structure`.
  - `src/store.ts` – `$DATA_DIR/home.json` load/save (atomic) + config migrations.
  - `src/discovery.ts` – finds Shellys by probing `/shelly` across the hub's /24 networks.
  - `src/main.ts` – HTTP API, WebSocket hub, static web, optional `DENY_LOCAL_PREFIXES` block.
  - `config/home.example.json` – example config.
- `web/` – plain HTML/CSS/JS web app, no build. `app.js` (home view, routing, live socket),
  `settings.js` (setup), `api.js`, `dom.js` (`h()` builder – never use innerHTML with user data).
  All UI text goes through `web/i18n.js`.
- `deploy/` – `setup-host.sh` (one-time Debian setup), `deploy.sh` (rsync + restart), systemd unit.

## Commands

```sh
cd server && npm install && npm run typecheck
PORT=8090 node src/main.ts         # empty home; set up via the app or copy config/home.example.json to data/
deploy/deploy.sh [ssh-target]      # default $SHELLY_HUB_TARGET or root@shelly-hub.local
```

## Conventions

- Code, comments, docs and commits in English. UI strings only via translation keys
  (`web/i18n.js`, English + Danish); never hard-code user-facing text.
- Keep the repo generic: no site-specific IPs, device IDs, network details or secrets.
  Site-specific files go in `local/` or `CLAUDE.local.md` (both gitignored).
- The hub API is the contract for the native apps – change it deliberately and keep it documented.
- Dependency-light and build-free (erasable TS syntax only, imports with `.ts` extensions).
- Don't use "Shelly" as the product/app name (trademark); "for Shelly devices" is fine.
- Changing settings on real devices or network gear affects someone's house: say what you'll
  change first, and verify by reading the setting back.
- Remove tools/packages installed for a one-off task when done.
