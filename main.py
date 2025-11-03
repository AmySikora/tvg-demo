from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
import uuid
import json, os

# ===== Config toggles =====
# Block duplicates even within the *same* marketplace (not just cross-market)?
BLOCK_WITHIN_MARKETPLACE = True

# ===== Persistence (JSON file) =====
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DATA_FILE = os.path.join(DATA_DIR, 'tickets.json')

def load_tickets():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_tickets(rows):
    try:
        with open(DATA_FILE, 'w') as f:
            json.dump(rows, f)
    except Exception:
        pass

# ===== App =====
app = FastAPI(title="Ticket VeriGuard Demo API", version="0.1.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===== Demo Event Catalog =====
EVENTS = {
    "nfl-seahawks-2025-11-02": {
        "event_id": "nfl-seahawks-2025-11-02",
        "name": "NFL — Seattle Seahawks vs. TBD (Home)",
        "venue": "Lumen Field, Seattle, WA",
        "date": "2025-11-02T13:05:00-07:00",
    },
    "festival-summer-2026-day1": {
        "event_id": "festival-summer-2026-day1",
        "name": "Summer Fest — Day 1",
        "venue": "Seattle Center",
        "date": "2026-07-10T12:00:00-07:00",
    },
}

# Persistent store
TICKETS: List[dict] = load_tickets()

# ===== Schemas =====
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

class BulkListRequest(BaseModel):
    marketplace: str
    event_id: str
    section: str
    row: Optional[str] = None
    seats: List[str]  # e.g., ["10","11","12"]

class BulkListResult(BaseModel):
    results: List[ListResponse]

# ===== Routes =====
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
            a["event_id"].strip().lower() == b["event_id"].strip().lower()
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

    # Duplicate detection
    duplicate: Optional[dict] = None
    for t in TICKETS:
        if not is_same_seat(t, new_ticket):
            continue
        same_market = t["marketplace"].strip().lower() == new_ticket["marketplace"].strip().lower()
        # If within-market blocking is ON, any same seat is a dup.
        # Otherwise, only treat it as dup if it's on a different marketplace.
        if BLOCK_WITHIN_MARKETPLACE or not same_market:
            duplicate = t
            break

    if duplicate:
        blocked = {**new_ticket, "decision": "BLOCKED_DUPLICATE", "duplicate_of_id": duplicate["id"]}
        TICKETS.append(blocked)
        save_tickets(TICKETS)
        return ListResponse(
            id=blocked["id"],
            decision="BLOCKED_DUPLICATE",
            duplicate_of_id=duplicate["id"],
            message="Duplicate detected — listing blocked",
            ticket=blocked,
        )

    approved = {**new_ticket, "decision": "APPROVED"}
    TICKETS.append(approved)
    save_tickets(TICKETS)
    return ListResponse(
        id=approved["id"],
        decision="APPROVED",
        message="Listing approved",
        ticket=approved,
    )

@app.post("/marketplace/bulk_list", response_model=BulkListResult)
def bulk_list(req: BulkListRequest):
    out: List[ListResponse] = []
    for s in req.seats:
        single = ListRequest(
            marketplace=req.marketplace,
            event_id=req.event_id,
            section=req.section,
            row=req.row,
            seat=s,
        )
        out.append(list_ticket(single))  # reuse core logic
    return {"results": out}
