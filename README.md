# Ticket VeriGuard — Demo (StubHub + Marketplace A)

This repo demonstrates real-time duplicate ticket prevention across marketplaces.  
Event used: **NFL — Seattle Seahawks (home)**.

## What it shows
- Listing on **StubHub** (approved ✅)
- Same seat on **Marketplace A** (blocked ❌)
- Live dashboard view with color-coded decisions

---

## Run locally

### 1) Backend (FastAPI)
```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Check: http://localhost:8000/health

### 2) Frontend (static)
```bash
cd frontend
python3 -m http.server 5173
# open http://localhost:5173/index.html
```

If your API is not at localhost:8000 (e.g., deployed), set it once in the browser console:
```js
localStorage.setItem('tvg_api','https://YOUR-API-HOST.com')
```

---

## Deploy

### API on Render (quick start)
1. Push repo to GitHub.
2. Render → New Web Service → pick this repo
3. Use **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Health check path: `/health`

(Alternatively: Heroku with included `Procfile`).

### Frontend on GitHub Pages
- Repo Settings → Pages → Deploy from branch → `main` → folder `/frontend`
- Visit the Pages URL and set your API base once:
  ```js
  localStorage.setItem('tvg_api','https://YOUR-API-HOST.com')
  ```

---

## Demo script
1. In **Simulator**, choose **StubHub**. Enter: Section `135`, Row `J`, Seat `12` → **Approved** ✅
2. Switch to **Marketplace A**, same seat → **Blocked duplicate** ❌
3. Open **Dashboard** → see green + red rows (newest first).

---

## Next steps
- Persist to SQLite/Postgres instead of in-memory
- Auth (API key) and per-market rules
- SSE/WebSockets for live updates instead of polling
