// app.js
import { fetchEvents, listTicket, fetchTickets, bulkList } from "./api.js";

/* -------------------------------
   API base: default + override
--------------------------------*/
const IS_DEV = ["localhost", "127.0.0.1"].includes(location.hostname);
const DEFAULT_API = IS_DEV ? "http://localhost:8000" : "https://tvg-demo.onrender.com";
if (!localStorage.getItem("tvg_api")) {
  localStorage.setItem("tvg_api", DEFAULT_API);
}

/* -------------------------------
   Per-browser session for "Mine"
--------------------------------*/
function uuid4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11)
    .replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
}
const TVG_SESSION = localStorage.getItem("tvg_session") || uuid4();
localStorage.setItem("tvg_session", TVG_SESSION);

// Track my created row IDs (if API returns them)
function getMyIds() {
  try { return new Set(JSON.parse(localStorage.getItem("tvg_my_ids") || "[]")); }
  catch { return new Set(); }
}
function addMyIds(ids) {
  const s = getMyIds();
  ids.forEach(id => id && s.add(id));
  localStorage.setItem("tvg_my_ids", JSON.stringify(Array.from(s)));
}

// ----- Seat "signature" helpers so Mine works even without ids/session -----
function rowKeyNorm(v) { return String(v ?? "").toUpperCase().replace(/O/g, "0"); }
function ticketSig({ marketplace, event_id, section, row, seat }) {
  return [
    String(marketplace || ""),
    String(event_id || ""),
    String(section || ""),
    rowKeyNorm(row || ""),
    String(seat || "")
  ].join("|");
}
function getMySigs() {
  try { return new Set(JSON.parse(localStorage.getItem("tvg_my_sigs") || "[]")); }
  catch { return new Set(); }
}
function addMySigs(sigs) {
  const s = getMySigs();
  sigs.forEach(sig => sig && s.add(sig));
  localStorage.setItem("tvg_my_sigs", JSON.stringify(Array.from(s)));
}

/* --------------------------------
   Helpers
---------------------------------*/
function populateEventsSelect(selectEl, events) {
  selectEl.innerHTML = "";
  events.forEach((e) => {
    const o = document.createElement("option");
    o.value = e.event_id;
    o.textContent = `${e.name} — ${new Date(e.date).toLocaleString()}`;
    selectEl.appendChild(o);
  });
}
function showEventsError(selectEl, err) {
  console.error("Failed to load events:", err);
  selectEl.innerHTML = "";
  const o = document.createElement("option");
  o.textContent = "Could not load events";
  o.value = "";
  selectEl.appendChild(o);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[m]));
}
// Parse "seats" field: commas, spaces, ranges; dedupe + sort
function parseSeats(raw) {
  const errors = [];
  if (!raw || !raw.trim())
    return { seats: [], errors: ["Enter at least one seat."], deduped: false };

  let s = raw.trim()
    .replace(/\s*-\s*/g, "-")
    .replace(/[ \t]+/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "");

  const parts = s.split(",");
  const out = [];

  for (const part of parts) {
    if (!part) continue;
    if (/^\d+\s*-\s*\d+$/.test(part)) {
      const [aStr, bStr] = part.split("-").map((x) => x.trim());
      const a = parseInt(aStr, 10), b = parseInt(bStr, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) { errors.push(`Bad range "${part}"`); continue; }
      if (a > b) { errors.push(`Range start > end in "${part}"`); continue; }
      for (let n = a; n <= b; n++) out.push(n);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n <= 0) errors.push(`Seat must be positive in "${part}"`);
      else out.push(n);
      continue;
    }
    errors.push(`Unrecognized token "${part}"`);
  }

  const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
  return { seats: uniq, errors, deduped: uniq.length !== out.length };
}

/* -----------------
   Simulator (unified)
------------------*/
const simForm = document.getElementById("sim-form");
if (simForm) {
  const sel = document.getElementById("event-select");
  const section = document.getElementById("section");
  const row = document.getElementById("row");
  const seatsInput = document.getElementById("seats");
  const chips = document.getElementById("chips");
  const count = document.getElementById("count");
  const normalized = document.getElementById("normalized");
  const submitBtn = document.getElementById("submitBtn");
  const resultEl = document.getElementById("result");

  const SUCCESS_CLEAR_MS = 2800;
  let userTouchedSeats = false;

  fetchEvents()
    .then((events) => populateEventsSelect(sel, events))
    .catch((err) => showEventsError(sel, err));

  function pill(text, type) {
    const base = "display:inline-block;padding:6px 10px;border-radius:999px;font-size:12px;margin-right:8px;border:1px solid;";
    const map = {
      ok: "background:rgba(16,185,129,.18);color:#8ef5d0;border-color:rgba(16,185,129,.35);",
      warn: "background:rgba(245,158,11,.16);color:#ffd38a;border-color:rgba(245,158,11,.35);",
      err: "background:rgba(239,68,68,.16);color:#ffb0b0;border-color:rgba(239,68,68,.35);",
    };
    return `<span style="${base}${map[type] || ""}">${text}</span>`;
  }
  function rowO0WarningMarkup(v) {
    const hasZero = /0/.test(v);
    const hasOh = /O/.test(v);
    const warnNeeded = (hasZero && hasOh) || /^[O0]+$/.test(v);
    if (!warnNeeded) return "";
    return `<span style="display:inline-block;padding:6px 10px;border-radius:999px;font-size:12px;margin-right:8px;border:1px solid;
      background:rgba(245,158,11,.16);color:#ffd38a;border-color:rgba(245,158,11,.35);">
      Heads up: O vs 0 can be confusing. We’ll normalize on the server.
    </span>`;
  }

  function render() {
    const { seats, errors, deduped } = parseSeats(seatsInput.value);
    const requiredMissing = !sel.value || !section.value.trim();

    chips.innerHTML = "";
    if (userTouchedSeats) {
      if (!requiredMissing && seats.length > 0 && errors.length === 0) chips.innerHTML += pill("Looks good", "ok");
      if (deduped) chips.innerHTML += pill("Duplicates removed", "warn");
      if (errors.length > 0) chips.innerHTML += pill("Fix errors", "err");
    }
    if (row.value) chips.innerHTML += rowO0WarningMarkup(row.value.toUpperCase());

    if (userTouchedSeats) {
      count.textContent = String(seats.length);
      normalized.textContent = seats.length ? seats.join(",") : "—";
    } else {
      count.textContent = "--";
      normalized.textContent = "--";
    }

    if (userTouchedSeats) {
      resultEl.innerHTML = errors.length ? `<div class="alert bad">${errors.join("<br/>")}</div>` : "";
    }

    submitBtn.disabled = !!(requiredMissing || errors.length || seats.length === 0);
  }

  ["change"].forEach((evt) => simForm.addEventListener(evt, render));
  seatsInput.addEventListener("input", () => { userTouchedSeats = true; render(); });
  section.addEventListener("input", () => {
    const cleaned = section.value.replace(/[oO]/g, "0").replace(/[^\d]/g, "");
    if (cleaned !== section.value) section.value = cleaned;
    render();
  });
  row.addEventListener("input", () => { row.value = row.value.toUpperCase(); render(); });
  sel.addEventListener("change", render);
  render();

  simForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;

    const { seats, errors } = parseSeats(seatsInput.value);
    if (errors.length || seats.length === 0) {
      userTouchedSeats = true;
      render();
      submitBtn.disabled = false;
      return;
    }

    const fd = new FormData(simForm);
    const basePayload = {
      marketplace: fd.get("marketplace"),
      event_id: fd.get("event_id"),
      section: fd.get("section"),
      row: ((fd.get("row") || "").trim() || null)?.toUpperCase() || null,
      client_session: TVG_SESSION
    };

    try {
      if (seats.length === 1) {
        const res = await listTicket({ ...basePayload, seat: String(seats[0]) });
        const ok = res.decision === "APPROVED";
        resultEl.innerHTML =
          `<div class="alert ${ok ? "ok" : "bad"}">
            <strong>${ok ? "Approved" : "Blocked"}</strong> — ${escapeHtml(res.message)}
            ${res.duplicate_of_id ? ` <small>(duplicate of ${escapeHtml(res.duplicate_of_id)})</small>` : ""}
            ${ok ? `&nbsp;&nbsp;<a href="dashboard.html" style="text-decoration:none;border:1px solid rgba(255,255,255,.25);padding:6px 10px;border-radius:10px;margin-left:8px;color:#eaf2ff;">View on Dashboard →</a>` : ""}
          </div>`;
        if (res?.id) addMyIds([res.id]);

        // Save signatures for Mine fallback
        addMySigs([
          ticketSig({
            marketplace: basePayload.marketplace,
            event_id: basePayload.event_id,
            section: basePayload.section,
            row: basePayload.row,
            seat: String(seats[0])
          })
        ]);

        setTimeout(() => { if (!userTouchedSeats) resultEl.innerHTML = ""; }, 2800);
      } else {
        const res = await bulkList({ ...basePayload, seats: seats.map(String) });
        const okCount = res.results.filter((r) => r.decision === "APPROVED").length;
        const badCount = res.results.length - okCount;
        resultEl.innerHTML =
          `<div class="alert ${badCount ? "bad" : "ok"}">
            <strong>Bulk complete</strong> — ${okCount} approved, ${badCount} blocked
            ${badCount === 0 ? `&nbsp;&nbsp;<a href="dashboard.html" style="text-decoration:none;border:1px solid rgba(255,255,255,.25);padding:6px 10px;border-radius:10px;margin-left:8px;color:#eaf2ff;">View on Dashboard →</a>` : ""}
          </div>`;
        if (Array.isArray(res?.results)) addMyIds(res.results.map(r => r.id).filter(Boolean));

        // Save signatures for Mine fallback
        addMySigs(
          seats.map(seat => ticketSig({
            marketplace: basePayload.marketplace,
            event_id: basePayload.event_id,
            section: basePayload.section,
            row: basePayload.row,
            seat: String(seat)
          }))
        );

        setTimeout(() => { if (!userTouchedSeats) resultEl.innerHTML = ""; }, 2800);
      }

      simForm.reset();
      userTouchedSeats = false;
      render();
      document.getElementById("section")?.focus();
      submitBtn.blur();
    } catch (err) {
      const msg = err?.message || (err?.body ? `${err.status || ""} ${err.body}` : "Unknown error");
      resultEl.innerHTML = `<div class="alert bad"><strong>Error</strong> — ${escapeHtml(msg)}</div>`;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ----------------
   Dashboard (simple selects + scope with robust "Mine")
-----------------*/
const onDashboard = document.getElementById("tickets-table");
if (onDashboard) {
  const tbody        = document.querySelector("#tickets-table tbody");
  const decisionEl   = document.getElementById("f-decision");
  const marketplaceEl= document.getElementById("f-marketplace");
  const eventEl      = document.getElementById("f-event");
  const sectionEl    = document.getElementById("f-section");
  const rowEl        = document.getElementById("f-row");
  const seatEl       = document.getElementById("f-seat");
  const limitEl      = document.getElementById("f-limit");
  const refreshEl    = document.getElementById("f-autorefresh");
  const scopeEl      = document.getElementById("f-scope");
  const resetBtn     = document.getElementById("f-reset");

  let allRows = [];
  let sortKey = "created_at";
  let sortDir = "desc";
  let timer   = null;

  function setTimer() {
    if (timer) clearInterval(timer);
    const ms = parseInt(refreshEl.value, 10);
    if (ms > 0) timer = setInterval(load, ms);
  }

  // Build select options only when changed (prevents Firefox jumpiness)
  function setOptionsIfChanged(selectEl, values) {
    const uniq = Array.from(new Set(values.filter(Boolean))).sort((a,b)=>String(a).localeCompare(String(b)));
    const currentSnapshot = Array.from(selectEl.options).map(o => o.value).join("|");
    const nextSnapshot = ["", ...uniq].join("|");
    if (currentSnapshot === nextSnapshot) return;

    const currentValue = selectEl.value;
    selectEl.innerHTML = '<option value="">All</option>' + uniq.map(v => `<option value="${String(v)}">${String(v)}</option>`).join("");
    if ([...selectEl.options].some(o => o.value === currentValue)) {
      selectEl.value = currentValue;
    }
  }

  function populateFiltersFromData(rows) {
    const knownMarkets = ["StubHub", "Marketplace A"];
    setOptionsIfChanged(marketplaceEl, [...knownMarkets, ...rows.map(r => r.marketplace)]);
    setOptionsIfChanged(eventEl, rows.map(r => r.event_id));
  }

  function matches(row) {
    // ---- Scope: All or Mine (robust) ----
    if (scopeEl.value === "mine") {
      if (row.client_session) {
        if (row.client_session !== TVG_SESSION) return false;
      } else {
        const mineIds = getMyIds();
        if (row.id && mineIds.has(row.id)) {
          // ok
        } else {
          const sig = ticketSig({
            marketplace: row.marketplace,
            event_id: row.event_id,
            section: row.section,
            row: row.row,
            seat: row.seat
          });
          const mineSigs = getMySigs();
          if (!mineSigs.has(sig)) return false;
        }
      }
    }

    // ---- Other filters ----
    const d = (decisionEl.value || "").trim();
    if (d && row.decision !== d) return false;

    const m = (marketplaceEl.value || "").trim();
    if (m && row.marketplace !== m) return false;

    const e = (eventEl.value || "").trim();
    if (e && row.event_id !== e) return false;

    const s = (sectionEl.value || "").trim();
    if (s && String(row.section || "") !== s) return false;

    const r = rowKeyNorm((rowEl.value || "").trim());
    if (r && rowKeyNorm(row.row) !== r) return false;

    const seat = (seatEl.value || "").trim();
    if (seat && String(row.seat || "") !== seat) return false;

    return true;
  }

  function draw() {
    const lim = parseInt(limitEl.value, 10) || 200;
    const rows = allRows
      .filter(matches)
      .sort((a, b) => {
        const A = a[sortKey], B = b[sortKey];
        if (sortKey === "created_at") {
          const ta = new Date(A).getTime(), tb = new Date(B).getTime();
          return sortDir === "asc" ? ta - tb : tb - ta;
        }
        if (sortKey === "seat" || sortKey === "section") {
          const na = Number(A), nb = Number(B);
          if (!Number.isNaN(na) && !Number.isNaN(nb)) {
            return sortDir === "asc" ? na - nb : nb - na;
          }
        }
        const sa = String(A || "").toLowerCase();
        const sb = String(B || "").toLowerCase();
        return sortDir === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
      })
      .slice(0, lim);

    tbody.innerHTML = "";
    rows.forEach((t) => {
      const tr = document.createElement("tr");
      const cls = t.decision === "BLOCKED_DUPLICATE" ? "bad" : "ok";
      const decisionBadge =
        t.decision === "BLOCKED_DUPLICATE"
          ? `<span class="badge bad">Blocked</span>`
          : `<span class="badge ok">Approved</span>`;
      tr.className = cls;
      tr.innerHTML = `
        <td>${t.id || ""}</td>
        <td>${decisionBadge}</td>
        <td>${t.marketplace || ""}</td>
        <td>${t.event_id || ""}</td>
        <td>${t.section || ""}</td>
        <td>${t.row || ""}</td>
        <td>${t.seat || ""}</td>
        <td>${new Date(t.created_at).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function load() {
    try {
      const rows = await fetchTickets();
      allRows = Array.isArray(rows) ? rows.slice().reverse() : [];
      populateFiltersFromData(allRows);
      draw();
    } catch (e) {
      console.error("Failed to load tickets:", e);
    }
  }

  // Sorting
  document.querySelectorAll("#tickets-table thead th[data-sort]").forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else { sortKey = key; sortDir = key === "created_at" ? "desc" : "asc"; }
      draw();
    });
  });

  // Filter listeners
  [decisionEl, marketplaceEl, eventEl, sectionEl, rowEl, seatEl, limitEl, scopeEl]
    .forEach(el => el.addEventListener("input", draw));
  [decisionEl, marketplaceEl, eventEl, limitEl, scopeEl]
    .forEach(el => el.addEventListener("change", draw));
  refreshEl.addEventListener("change", setTimer);

  // Reset
  resetBtn.addEventListener("click", () => {
    decisionEl.value = "";
    marketplaceEl.value = "";
    eventEl.value = "";
    sectionEl.value = "";
    rowEl.value = "";
    seatEl.value = "";
    limitEl.value = "200";
    scopeEl.value = "all";
    draw();
  });

  await load();
  setTimer();
}

/* --------------------------
   API Switcher (gear)
---------------------------*/
(function apiSwitcher() {
  const gear = document.getElementById("api-gear");
  const panel = document.getElementById("api-panel");
  if (!gear || !panel) return;

  const effective = localStorage.getItem("tvg_api") || DEFAULT_API;
  const curEl = panel.querySelector("#api-current");
  if (curEl) curEl.textContent = effective;

  gear.addEventListener("click", () => { panel.hidden = !panel.hidden; });

  panel.querySelectorAll(".api-actions .btn[data-api]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const url = btn.getAttribute("data-api");
      localStorage.setItem("tvg_api", url);
      location.reload();
    });
  });

  const clearBtn = document.getElementById("api-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      localStorage.removeItem("tvg_api");
      location.reload();
    });
  }

  const saveBtn = document.getElementById("api-save");
  const custom = document.getElementById("api-custom");
  if (saveBtn && custom) {
    saveBtn.addEventListener("click", () => {
      const v = (custom.value || "").trim();
      if (!v) return;
      localStorage.setItem("tvg_api", v);
      location.reload();
    });
  }

  document.addEventListener("click", (e) => {
    if (panel.hidden) return;
    if (e.target === gear || panel.contains(e.target)) return;
    panel.hidden = true;
  });
})();
