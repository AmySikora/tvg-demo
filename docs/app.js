// app.js
import { fetchEvents, listTicket, fetchTickets, bulkList } from "./api.js";

/* -------------------------------
   API base: default + override
--------------------------------*/
const IS_DEV = ["localhost", "127.0.0.1"].includes(location.hostname);
const DEFAULT_API = IS_DEV
  ? "http://localhost:8000"
  : "https://tvg-demo.onrender.com";

// If the user hasn't chosen anything yet, set a default so it just works.
if (!localStorage.getItem("tvg_api")) {
  localStorage.setItem("tvg_api", DEFAULT_API);
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
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

// Parse "seats" field: commas, spaces, ranges; dedupe + sort
function parseSeats(raw) {
  const errors = [];
  if (!raw || !raw.trim())
    return { seats: [], errors: ["Enter at least one seat."], deduped: false };

  let s = raw
    .trim()
    .replace(/\s*-\s*/g, "-") // tighten ranges
    .replace(/[ \t]+/g, ",") // spaces -> commas
    .replace(/,+/g, ",") // collapse commas
    .replace(/^,|,$/g, ""); // trim commas

  const parts = s.split(",");
  const out = [];

  for (const part of parts) {
    if (!part) continue;

    if (/^\d+\s*-\s*\d+$/.test(part)) {
      // range
      const [aStr, bStr] = part.split("-").map((x) => x.trim());
      const a = parseInt(aStr, 10),
        b = parseInt(bStr, 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
        errors.push(`Bad range "${part}"`);
        continue;
      }
      if (a > b) {
        errors.push(`Range start > end in "${part}"`);
        continue;
      }
      for (let n = a; n <= b; n++) out.push(n);
      continue;
    }

    if (/^\d+$/.test(part)) {
      // single
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

  const SUCCESS_CLEAR_MS = 2800; // how long the success banner stays visible
  let userTouchedSeats = false; // controls when validation UI appears

  fetchEvents()
    .then((events) => populateEventsSelect(sel, events))
    .catch((err) => showEventsError(sel, err));

  function pill(text, type) {
    const base =
      "display:inline-block;padding:6px 10px;border-radius:999px;font-size:12px;margin-right:8px;border:1px solid;";
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
      if (!requiredMissing && seats.length > 0 && errors.length === 0)
        chips.innerHTML += pill("Looks good", "ok");
      if (deduped) chips.innerHTML += pill("Duplicates removed", "warn");
      if (errors.length > 0) chips.innerHTML += pill("Fix errors", "err");
    }
    // Add soft warning for row O/0 ambiguity (always okay to submit)
    if (row.value) chips.innerHTML += rowO0WarningMarkup(row.value.toUpperCase());

    if (userTouchedSeats) {
      count.textContent = String(seats.length);
      normalized.textContent = seats.length ? seats.join(",") : "—";
    } else {
      count.textContent = "--";
      normalized.textContent = "--";
    }

    // Only show validation errors after user interacts; otherwise keep whatever
    // is in resultEl (e.g., a success message after submit).
    if (userTouchedSeats) {
      resultEl.innerHTML = errors.length
        ? `<div class="alert bad">${errors.join("<br/>")}</div>`
        : "";
    }

    submitBtn.disabled = !!(
      requiredMissing ||
      errors.length ||
      seats.length === 0
    );
  }

  // Drive "dirty" state + normalizers
  ["change"].forEach((evt) => simForm.addEventListener(evt, render));
  seatsInput.addEventListener("input", () => {
    userTouchedSeats = true;
    render();
  });
  section.addEventListener("input", () => {
    // Swap O/o -> 0 and strip non-digits; this keeps section numeric and avoids O/0 confusion
    const cleaned = section.value.replace(/[oO]/g, "0").replace(/[^\d]/g, "");
    if (cleaned !== section.value) section.value = cleaned;
    render();
  });
  row.addEventListener("input", () => {
    row.value = row.value.toUpperCase();
    render();
  });
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
      row: ((fd.get("row") || "").trim() || null)?.toUpperCase() || null, // normalize row
    };

    try {
      if (seats.length === 1) {
        // Single-seat listing
        const res = await listTicket({ ...basePayload, seat: String(seats[0]) });
        const ok = res.decision === "APPROVED";

        resultEl.innerHTML =
          `<div class="alert ${ok ? "ok" : "bad"}">
            <strong>${ok ? "Approved" : "Blocked"}</strong> — ${escapeHtml(res.message)}
            ${res.duplicate_of_id ? ` <small>(duplicate of ${escapeHtml(res.duplicate_of_id)})</small>` : ""}
            ${ok ? `&nbsp;&nbsp;<a href="dashboard.html" style="text-decoration:none;border:1px solid rgba(255,255,255,.25);padding:6px 10px;border-radius:10px;margin-left:8px;color:#eaf2ff;">View on Dashboard →</a>` : ""}
          </div>`;

        // Auto-dismiss after a moment if user hasn’t started typing again
        setTimeout(() => {
          if (!userTouchedSeats) resultEl.innerHTML = "";
        }, SUCCESS_CLEAR_MS);
      } else {
        // Bulk listing (send seats as strings to satisfy FastAPI validators)
        const res = await bulkList({ ...basePayload, seats: seats.map(String) });
        const okCount = res.results.filter((r) => r.decision === "APPROVED").length;
        const badCount = res.results.length - okCount;

        resultEl.innerHTML =
          `<div class="alert ${badCount ? "bad" : "ok"}">
            <strong>Bulk complete</strong> — ${okCount} approved, ${badCount} blocked
            ${badCount === 0 ? `&nbsp;&nbsp;<a href="dashboard.html" style="text-decoration:none;border:1px solid rgba(255,255,255,.25);padding:6px 10px;border-radius:10px;margin-left:8px;color:#eaf2ff;">View on Dashboard →</a>` : ""}
          </div>`;

        setTimeout(() => {
          if (!userTouchedSeats) resultEl.innerHTML = "";
        }, SUCCESS_CLEAR_MS);
      }

      // Calm reset for next entry
      simForm.reset();
      userTouchedSeats = false;
      render();

      // User guidance → back to first field
      document.getElementById("section")?.focus();
      submitBtn.blur();
    } catch (err) {
      const msg =
        err?.message ||
        (err?.body ? `${err.status || ""} ${err.body}` : "Unknown error");
      resultEl.innerHTML = `<div class="alert bad"><strong>Error</strong> — ${escapeHtml(
        msg
      )}</div>`;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ----------------
   Dashboard
-----------------*/
const onDashboard = document.getElementById("tickets-table");
if (onDashboard) {
  async function load() {
    const rows = await fetchTickets();
    const tbody = document.querySelector("#tickets-table tbody");
    tbody.innerHTML = "";
    rows
      .slice()
      .reverse()
      .forEach((t) => {
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
  load();
  setInterval(load, 2500);
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

  gear.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

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
