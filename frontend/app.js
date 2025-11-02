import {fetchEvents, listTicket, fetchTickets} from './api.js';

const onSimulator = document.getElementById('list-form');
const onDashboard = document.getElementById('tickets-table');

if(onSimulator){
  const sel = document.getElementById('event-select');
  fetchEvents().then(events => {
    events.forEach(e => {
      const o = document.createElement('option');
      o.value = e.event_id; o.textContent = `${e.name} — ${new Date(e.date).toLocaleString()}`;
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

if(onDashboard){
  async function load(){
    const rows = await fetchTickets();
    const tbody = document.querySelector('#tickets-table tbody');
    tbody.innerHTML = '';
    rows.slice().reverse().forEach(t => {
      const tr = document.createElement('tr');
      tr.className = t.decision === 'BLOCKED_DUPLICATE' ? 'bad' : 'ok';
      tr.innerHTML = `
        <td>${t.id || ''}</td>
        <td>${t.decision || ''}</td>
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
