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

from fastapi import FastAPI, HTTPException
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
    return {"results": out}
