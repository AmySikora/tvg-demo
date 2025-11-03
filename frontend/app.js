import { fetchEvents, listTicket, fetchTickets, bulkList } from './api.js';

const onSimulator = document.getElementById('list-form');
const onDashboard = document.getElementById('tickets-table');

// ----- Simulator -----
if (onSimulator) {
  const sel = document.getElementById('event-select');
  fetchEvents().then(events => {
    sel.innerHTML = '';
    events.forEach(e => {
      const o = document.createElement('option');
      o.value = e.event_id;
      o.textContent = `${e.name} — ${new Date(e.date).toLocaleString()}`;
      sel.appendChild(o);
    });
  });

  onSimulator.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(onSimulator);
    const payload = Object.fromEntries(fd.entries());
    try{
      const res = await listTicket(payload);
      showResult(res);
      onSimulator.reset();
    }catch(err){
      showError(err.message);
    }
  });

  function showResult(res){
    const el = document.getElementById('result');
    const ok = res.decision === 'APPROVED';
    el.innerHTML = `<div class="alert ${ok?'ok':'bad'}">`
      + `<strong>${ok?'Approved':'Blocked'}</strong> — ${res.message}`
      + (res.duplicate_of_id?` <small>(duplicate of ${res.duplicate_of_id})</small>`:'')
      + `</div>`;
  }
  function showError(msg){
    const el = document.getElementById('result');
    el.innerHTML = `<div class="alert bad"><strong>Error</strong> — ${msg}</div>`;
  }
}

// ----- Bulk form -----
const bulkForm = document.getElementById('bulk-form');
if (bulkForm) {
  const sel = document.getElementById('bulk-event');
  fetchEvents().then(events => {
    sel.innerHTML = '';
    events.forEach(e => {
      const o = document.createElement('option');
      o.value = e.event_id;
      o.textContent = `${e.name} — ${new Date(e.date).toLocaleString()}`;
      sel.appendChild(o);
    });
  });

  bulkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(bulkForm);
    const seats = (fd.get('seats')||'').split(',').map(s=>s.trim()).filter(Boolean);
    const payload = {
      marketplace: fd.get('marketplace'),
      event_id: fd.get('event_id'),
      section: fd.get('section'),
      row: fd.get('row')||null,
      seats,
    };
    try{
      const res = await bulkList(payload);
      const okCount = res.results.filter(r=>r.decision==='APPROVED').length;
      const badCount = res.results.length - okCount;
      document.getElementById('bulk-result').innerHTML =
        `<div class="alert ${badCount? 'bad':'ok'}"><strong>Bulk complete</strong> — `
        + `${okCount} approved, ${badCount} blocked</div>`;
      bulkForm.reset();
    }catch(err){
      document.getElementById('bulk-result').innerHTML =
        `<div class="alert bad"><strong>Error</strong> — ${err.message}</div>`;
    }
  });
}

// ----- Dashboard -----
if (onDashboard) {
  async function load(){
    const rows = await fetchTickets();
    const tbody = document.querySelector('#tickets-table tbody');
    tbody.innerHTML = '';
    rows.slice().reverse().forEach(t => {
      const tr = document.createElement('tr');
      const cls = t.decision === 'BLOCKED_DUPLICATE' ? 'bad' : 'ok';
      const decisionBadge =
        t.decision === 'BLOCKED_DUPLICATE'
          ? `<span class="badge bad">Blocked</span>`
          : `<span class="badge ok">Approved</span>`;
      tr.className = cls;
      tr.innerHTML = `
        <td>${t.id || ''}</td>
        <td>${decisionBadge}</td>
        <td>${t.marketplace || ''}</td>
        <td>${t.event_id || ''}</td>
        <td>${t.section || ''}</td>
        <td>${t.row || ''}</td>
        <td>${t.seat || ''}</td>
        <td>${new Date(t.created_at).toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  }
  load();
  setInterval(load, 2500);
}
