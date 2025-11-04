// api.js
const RENDER_URL = "https://tvg-demo.onrender.com";

function getApiBase() {
  const override = localStorage.getItem("tvg_api");
  if (override && override.trim()) return override.trim();
  return RENDER_URL; // default is your Render API
}

function setApiBase(url) {
  localStorage.setItem("tvg_api", url);
}

async function fetchJSON(path, options = {}, { allowFailover = true } = {}) {
  let base = getApiBase();
  const url = `${base}${path}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(t);

    // If server reachable but CORS blocked (rare with your FastAPI *), throw to allow failover.
    if (!res.ok) {
      let detail = "Request failed";
      try {
        const j = await res.json();
        detail = j.detail || detail;
      } catch {}
      throw new Error(detail);
    }
    return res.json();
  } catch (err) {
    // If we were pointing at localhost and it failed (offline/CORS/etc),
    // fail over to Render once and persist it so next loads work.
    if (allowFailover && base.startsWith("http://localhost")) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`${RENDER_URL}${path}`, { ...options, signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) throw new Error("Fallback failed");
        // Lock in the working base for future loads
        setApiBase(RENDER_URL);
        console.info("[API] Fell back to Render and saved it:", RENDER_URL);
        return res.json();
      } catch {}
    }
    throw new Error("Network error. Please try again.");
  }
}

export async function fetchEvents() {
  return fetchJSON("/events");
}

export async function listTicket(payload) {
  return fetchJSON("/marketplace/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function fetchTickets() {
  return fetchJSON("/tickets");
}

export async function bulkList(payload) {
  return fetchJSON("/marketplace/bulk_list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
