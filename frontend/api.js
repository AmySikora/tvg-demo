export const API_BASE = localStorage.getItem("tvg_api") || "http://localhost:8000";

export async function fetchEvents(){
  const res = await fetch(`${API_BASE}/events`);
  return res.json();
}

export async function listTicket(payload){
  const res = await fetch(`${API_BASE}/marketplace/list`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  });
  if(!res.ok){
    const err = await res.json().catch(()=>({detail:"Error"}));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export async function fetchTickets(){
  const res = await fetch(`${API_BASE}/tickets`);
  return res.json();
}
