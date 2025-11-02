from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid

app = FastAPI(title="Ticket VeriGuard Demo API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Demo Event Catalog ---
EVENTS = {
    # Seahawks home game (demo id)
    "nfl-seahawks-2025-11-02": {
        "event_id": "nfl-seahawks-2025-11-02",
        "name": "NFL — Seattle Seahawks vs. TBD (Home)",
        "venue": "Lumen Field, Seattle, WA",
        "date": "2025-11-02T13:05:00-07:00",
    }
}

# In-memory store for demo
TICKETS: List[dict] = []

class ListRequest(BaseModel):
    marketplace: str = Field(..., description="e.g., 'StubHub' or 'Marketplace A'")
    event_id: str = Field(..., description="Event identifier from catalog")
    section: str
    row: Optional[str] = None
    seat: str

class ListResponse(BaseModel):
    id: str
    decision: str  # APPROVED or BLOCKED_DUPLICATE
    duplicate_of_id: Optional[str] = None
    message: str
    ticket: dict

@app.get("/health")
def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat() + "Z"}

@app.get("/events")
def get_events():
    return list(EVENTS.values())

@app.get("/events/{event_id}")
def get_event(event_id: str):
    evt = EVENTS.get(event_id)
    if not evt:
        raise HTTPException(status_code=404, detail="Event not found")
    return evt

@app.get("/tickets")
def get_tickets():
    return TICKETS

@app.post("/marketplace/list", response_model=ListResponse)
def list_ticket(req: ListRequest):
    if req.event_id not in EVENTS:
        raise HTTPException(status_code=400, detail="Unknown event_id")

    def is_same_seat(a, b):
        return (
            a["event_id"].lower() == b["event_id"].lower()
            and a["section"].strip().lower() == b["section"].strip().lower()
            and (a.get("row") or "").strip().lower() == (b.get("row") or "").strip().lower()
            and a["seat"].strip().lower() == b["seat"].strip().lower()
        )

    new_ticket = {
        "id": uuid.uuid4().hex[:12],
        "marketplace": req.marketplace,
        "event_id": req.event_id,
        "section": req.section,
        "row": req.row,
        "seat": req.seat,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    # Duplicate detection against *other* listings
    duplicate: Optional[dict] = None
    for t in TICKETS:
        if is_same_seat(t, new_ticket) and t["marketplace"].lower() != new_ticket["marketplace"].lower():
            duplicate = t
            break

    if duplicate:
        # Record the attempted blocked listing for audit trail
        blocked = {**new_ticket, "decision": "BLOCKED_DUPLICATE", "duplicate_of_id": duplicate["id"]}
        TICKETS.append(blocked)
        return ListResponse(
            id=blocked["id"],
            decision="BLOCKED_DUPLICATE",
            duplicate_of_id=duplicate["id"],
            message="Duplicate detected across marketplaces — listing blocked",
            ticket=blocked,
        )

    approved = {**new_ticket, "decision": "APPROVED"}
    TICKETS.append(approved)
    return ListResponse(
        id=approved["id"],
        decision="APPROVED",
        message="Listing approved",
        ticket=approved,
    )
