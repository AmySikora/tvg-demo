"""
Ticket VeriGuard Demo API
- FastAPI app with simple JSON persistence
- Duplicate-seat detection across (and optionally within) marketplaces
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Header 
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ==============================
# Config
# ==============================

# Block duplicates even within the *same* marketplace (not just cross-market)?
BLOCK_WITHIN_MARKETPLACE = True

# Data file (JSON) for simple persistence
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)
DATA_FILE = os.path.join(DATA_DIR, "tickets.json")
EVENTS_FILE = os.path.join(DATA_DIR, "events.json")
ADMIN_KEY = os.getenv("ADMIN_KEY", "").strip()  # set this in Render env vars for protection

# Allowed CORS origins (Render, GitHub Pages, your domain, and local dev).
# You can override by setting FRONTEND_ORIGINS to a comma-separated list.
DEFAULT_ALLOWED_ORIGINS = [
    "https://amysikora.github.io",
    "https://ticketveriguard.com",
    "https://www.ticketveriguard.com",
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://localhost:5173",
    "http://localhost:8000",
]
ENV_ORIGINS = os.getenv("FRONTEND_ORIGINS", "").strip()
ALLOWED_ORIGINS = (
    [o.strip() for o in ENV_ORIGINS.split(",") if o.strip()]
    if ENV_ORIGINS
    else DEFAULT_ALLOWED_ORIGINS
)


# ==============================
# Persistence helpers
# ==============================

def load_tickets() -> List[dict]:
    """Load ticket rows from JSON; return [] if missing or invalid."""
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
        except Exception:
            # Fall through to empty list if file is corrupt
            pass
    return []


def save_tickets(rows: List[dict]) -> None:
    """Persist ticket rows to JSON (best effort)."""
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False)
    except Exception:
        # Non-fatal in a demo API
        pass


# ==============================
# App
# ==============================

app = FastAPI(title="Ticket VeriGuard Demo API", version="0.1.3")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================
# Demo Event Catalog
# ==============================
DEFAULT_EVENTS = {
    "nfl-seahawks-2026-11-02": {
        "event_id": "nfl-seahawks-2026-11-02",
        "name": "NFL — Seattle Seahawks vs. TBD (Home)",
        "venue": "Lumen Field, Seattle, WA",
        "date": "2026-11-02T13:05:00-07:00",
    },
    "festival-summer-2026-day1": {
        "event_id": "festival-summer-2026-day1",
        "name": "Summer Fest — Day 1",
        "venue": "Seattle Center",
        "date": "2026-07-10T12:00:00-07:00",
    },
}
def require_admin(x_admin_key: Optional[str]) -> None:
    if not ADMIN_KEY:
        # If no key is set, leave it open (demo mode).
        return
    if not x_admin_key or x_admin_key.strip() != ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
def load_events() -> dict:
    """Load events from JSON; if missing, seed defaults."""
    if os.path.exists(EVENTS_FILE):
        try:
            with open(EVENTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    return data
        except Exception:
            pass

    # Seed defaults
    save_events(DEFAULT_EVENTS)
    return DEFAULT_EVENTS.copy()

def save_events(events: dict) -> None:
    """Persist events to JSON (best effort)."""
    try:
        with open(EVENTS_FILE, "w", encoding="utf-8") as f:
            json.dump(events, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

EVENTS = load_events()

# Persistent store
TICKETS: List[dict] = load_tickets()


# ==============================
# Models
# ==============================

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
    seats: List[str]  # e.g., ["10", "11", "12"]


class BulkListResult(BaseModel):
    results: List[ListResponse]

class EventCreate(BaseModel):
    event_id: Optional[str] = None
    name: str
    venue: str
    date: str  # keep as ISO string for now

class EventUpdate(BaseModel):
    name: Optional[str] = None
    venue: Optional[str] = None
    date: Optional[str] = None


# ==============================
# Routes
# ==============================

@app.get("/")
def root():
    return {
        "name": "Ticket VeriGuard Demo API",
        "version": app.version,
        "health": "/health",
        "events": "/events",
        "tickets": "/tickets",
        "allowed_origins": ALLOWED_ORIGINS,
    }


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

    def is_same_seat(a: dict, b: dict) -> bool:
        return (
            a["event_id"].strip().lower() == b["event_id"].strip().lower()
            and a["section"].strip().lower() == b["section"].strip().lower()
            and (a.get("row") or "").strip().lower()
            == (b.get("row") or "").strip().lower()
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
        same_market = (
            t["marketplace"].strip().lower()
            == new_ticket["marketplace"].strip().lower()
        )
        # If within-market blocking is ON, any same seat is a dup.
        # Otherwise, only treat as dup if it's on a different marketplace.
        if BLOCK_WITHIN_MARKETPLACE or not same_market:
            duplicate = t
            break

    if duplicate:
        blocked = {
            **new_ticket,
            "decision": "BLOCKED_DUPLICATE",
            "duplicate_of_id": duplicate["id"],
        }
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
    return {"results": out} # add to imports at top

@app.post("/events")
def create_event(payload: EventCreate, x_admin_key: Optional[str] = Header(None)):
    require_admin(x_admin_key)

    # create stable id if not supplied
    event_id = (payload.event_id or "").strip()
    if not event_id:
        event_id = uuid.uuid4().hex[:10]

    if event_id in EVENTS:
        raise HTTPException(status_code=409, detail="event_id already exists")

    evt = {
        "event_id": event_id,
        "name": payload.name,
        "venue": payload.venue,
        "date": payload.date,
    }
    EVENTS[event_id] = evt
    save_events(EVENTS)
    return evt


@app.put("/events/{event_id}")
def update_event(event_id: str, payload: EventUpdate, x_admin_key: Optional[str] = Header(None)):
    require_admin(x_admin_key)

    evt = EVENTS.get(event_id)
    if not evt:
        raise HTTPException(status_code=404, detail="Event not found")

    if payload.name is not None:
        evt["name"] = payload.name
    if payload.venue is not None:
        evt["venue"] = payload.venue
    if payload.date is not None:
        evt["date"] = payload.date

    EVENTS[event_id] = evt
    save_events(EVENTS)
    return evt


@app.delete("/events/{event_id}")
def delete_event(event_id: str, x_admin_key: Optional[str] = Header(None)):
    require_admin(x_admin_key)

    if event_id not in EVENTS:
        raise HTTPException(status_code=404, detail="Event not found")

    deleted = EVENTS.pop(event_id)
    save_events(EVENTS)
    return {"deleted": deleted}