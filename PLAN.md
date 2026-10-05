# Simple – Plan

**Simple** is an easy, local-only way to use Shelly smart home devices – without the
engineering-style official app. A small hub on the home network talks to the Shellys;
people use a clean app on their phone (iOS, Android) or in the browser.

The code is public so others can run and extend it. Ready-made iOS and Android apps are
published in the App Store and Google Play, so people who just want to use it install the app
and run the hub from this repo.

## Goals

- **Simple for everyone** – rooms and actions, not device IDs and settings. Setup without
  editing files.
- **Offline first** – everything works with no internet; nothing leaves the house.
- **Easy to install** – one command or one image on a Raspberry Pi, a NAS, Docker or Proxmox.
- **Fast** – state changes show up instantly on every screen (push, not polling).
- **Multilingual** – all UI text translatable; English and Danish first.
- **Secure by default** – only paired devices can control the house.

## Architecture

```
 iOS app (Swift)   Android app (Kotlin)   Browser (web app)
        └──────────────┬───────────────────────┘
                       │ HTTP + WebSocket, local network
                       │ hub found via mDNS (_simplehub._tcp), paired via QR code
                       ▼
 Hub (Node 24 / TypeScript, Fastify)
   ├─ API + WebSocket       stable, versioned – shared by all apps
   ├─ Device manager        discovery, Shelly RPC, live status
   ├─ Rules & schedules     actions, timers, sunrise/sunset
   └─ Storage               config + history (JSON now, SQLite later)
                       │ Shelly Gen2+ local RPC over WebSocket
                       ▼
 Shelly devices
```

Key technical choices:

- **Shelly Gen2+ RPC over the device's WebSocket** (`ws://<ip>/rpc`): devices push
  `NotifyStatus`, so no polling and no device config changes needed.
- **mDNS (`_shelly._tcp`) + subnet scan** for finding Shellys.
- **Native apps** (Swift/SwiftUI, Kotlin/Jetpack Compose) on top of a documented hub API.
- **Bluetooth onboarding in the native apps**: new Shellys get WiFi credentials over BLE from
  the phone, so setup never involves the device's WiFi hotspot. The hub itself needs no Bluetooth.
- **Web app** (plain HTML/CSS/JS, no build) served by the hub – works on any device.
- **No build step on the hub** – Node runs the TypeScript directly.

## Phases

### Phase 1 – Hub core ✅
- [x] Shelly client (switch, light/dimmer) with push updates, keepalive, reconnect.
- [x] REST + WebSocket API; config file with rooms and devices.
- [x] Optional blocking of requests arriving via the IoT/guest network.
- [x] systemd deployment on Debian.

### Phase 2 – Web app MVP
- [x] Rooms with big tap targets: on/off, dimming, live status, power usage.
- [x] Translations (English, Danish), language from device settings.
- [ ] Installable PWA (service worker, PNG icons) + kiosk mode for a wall tablet.

### Phase 3 – Setup without files (needed before public release)
- [x] Discovery: subnet scan of the hub's networks (`/shelly` probe) at startup, every 5 min
      and when setup opens; new devices pushed live to the apps. Probe by IP as a fallback.
- [x] Adopt channels in the app: name, room; rename, move, remove. (Not adopting = hidden.)
- [x] Rooms management in the app: add, rename, reorder, delete (devices become unassigned).
- [x] Config persisted by the hub (atomic writes to `$DATA_DIR/home.json`, auto-migration).
- [x] Follow devices that change IP (on scan, and background rescan while any device is offline).
- [ ] mDNS discovery for instant results.
- [ ] Covers/roller shutters, inputs, sensors (H&T, door/window), plugs with power metering.

### Phase 4 – Pairing, security and API for native apps
- [ ] Hub announces itself via mDNS.
- [ ] Pairing: hub shows a QR code / code; apps get a token; unpaired requests refused.
- [ ] Users/roles: admin vs. everyday user.
- [ ] Versioned, documented API (OpenAPI) as the contract for the iOS/Android apps.
- [ ] Optional: set Shelly auth + disable Shelly cloud from the hub.

### Phase 5 – Native apps
- [ ] iOS app (SwiftUI): find hub, pair, rooms, control, live updates, widgets.
- [ ] Android app (Kotlin, Jetpack Compose): same feature set.
- [ ] **Add brand-new Shellys over Bluetooth** (key feature – the hardest part of the official app):
  - App scans for unprovisioned Shelly Gen2+ devices nearby via BLE and shows
    "New Shelly found nearby".
  - User taps Add; the app sends the home WiFi credentials over Shelly's BLE RPC
    (`WiFi.SetConfig`), optionally also disables cloud / sets auth in the same step.
  - The hub finds the device on the network and the app continues straight into
    name + room – no WiFi hotspot switching, no IP addresses.
  - WiFi credentials: entered once in the app and kept in the phone's keychain/keystore;
    never sent to the hub.
  - Test with a new or factory-reset Gen4 device.
- [ ] Localisation shared with the web app (same keys).
- [ ] App Store / Google Play listings (local network + Bluetooth permissions, privacy policy:
      no data collected).

### Phase 6 – Easy install
- [ ] Docker image + `docker compose` example.
- [ ] One-line installer for Debian/Raspberry Pi OS.
- [ ] Proxmox LXC helper script.
- [ ] Self-hosting guide (networks/VLANs, IoT network isolation).

### Phase 7 – Actions, automation, history
- [ ] Actions ("Good night", "Away", "Cosy") – one tap sets many devices. UI name: "Actions" (en), "Handlinger" (da) – deliberately not "Scenes".
- [ ] Schedules incl. sunrise/sunset (calculated locally).
- [ ] Simple rules: trigger (input, sensor, time) → action.
- [ ] Energy and sensor history with graphs.
- [ ] Firmware overview and update from the app; backup/restore of hub config.
- [ ] Remote access via WireGuard/Tailscale (still no cloud).

## Naming

App name **Simple**. Store listings must not use "Shelly" as part of the app name
(trademark); describing compatibility ("works with Shelly devices") is fine.

## License

PolyForm Noncommercial 1.0.0 – free for personal and other noncommercial use; commercial use
requires a separate license from the author.
