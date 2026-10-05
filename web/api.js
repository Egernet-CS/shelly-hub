// Thin client for the hub API. Throws Error(message) on non-2xx responses.

async function request(method, path, body) {
  const res = await fetch(`api/${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? res.statusText);
  }
  return res.status === 204 ? null : res.json();
}

const enc = encodeURIComponent;

export const api = {
  command: (id, cmd) => request("POST", `devices/${enc(id)}/command`, cmd),
  addDevice: (device) => request("POST", "devices", device),
  updateDevice: (id, patch) => request("PATCH", `devices/${enc(id)}`, patch),
  removeDevice: (id) => request("DELETE", `devices/${enc(id)}`),
  addRoom: (name) => request("POST", "rooms", { name }),
  renameRoom: (id, name) => request("PATCH", `rooms/${enc(id)}`, { name }),
  moveRoom: (id, direction) => request("POST", `rooms/${enc(id)}/move`, { direction }),
  removeRoom: (id) => request("DELETE", `rooms/${enc(id)}`),
  scan: (host) => request("POST", "discovery/scan", host ? { host } : {}),
};
