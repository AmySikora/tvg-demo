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
  const base = getApiBase();
  const url = `${base}${path}`;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(t);

    if (!res.ok) {
      // Surface FastAPI error details when possible
      let detail = `HTTP ${res.status}`;
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        detail = j.detail || j.message || detail;
      } catch {
        if (text) detail = `${detail} — ${text}`;
      }
      const err = new Error(detail);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    return res.json();
  } catch (err) {
    // If dev/local failed, try the hosted API once and persist it
    if (allowFailover && base.startsWith("http://localhost")) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`${RENDER_URL}${path}`, { ...options, signal: ctrl.signal });
        clearTimeout(t);

        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          const text = await res.text();
          try {
            const j = JSON.parse(text);
            detail = j.detail || j.message || detail;
          } catch {
            if (text) detail = `${detail} — ${text}`;
          }
          const err2 = new Error(detail);
          err2.status = res.status;
          err2.body = text;
          throw err2;
        }

        setApiBase(RENDER_URL);
        console.info("[API] Fell back to Render and saved it:", RENDER_URL);
        return res.json();
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }

    // Re-throw original error so UI can display it
    throw err;
  }
}

/* --------- Public API --------- */
export async function fetchEvents() {
  return fetchJSON("/events");
}

export async function listTicket(payload) {
  return fetchJSON("/marketplace/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchTickets() {
  return fetchJSON("/tickets");
}

export async function bulkList(payload) {
  return fetchJSON("/marketplace/bulk_list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), // seats come as strings from app.js
  });
}
