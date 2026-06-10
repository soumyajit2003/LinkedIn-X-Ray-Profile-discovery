# Setup Guide — Interactive Tour

Follow each step in order. Check the box as you complete each one.

---

## Step 1 of 6 — Clone & Enter Project

```bash
git clone <your-repo-url>
cd linkedin-xray-search
```

> **What this does:** Downloads the project to your machine.

- [ ] Done — I'm inside the `linkedin-xray-search` folder

---

## Step 2 of 6 — Install Node Dependencies (Frontend + Root)

```bash
npm install
cd frontend && npm install && cd ..
```

> **What this does:** Installs the root monorepo tools (`concurrently`) and frontend packages (Next.js, React, Tailwind).

**Verify:**
```bash
ls node_modules/.bin/concurrently && echo "Root OK"
ls frontend/node_modules/.bin/next && echo "Frontend OK"
```

- [ ] Done — Both show "OK"

---

## Step 3 of 6 — Install Python Dependencies (Backend)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

> **What this does:** Creates an isolated Python environment and installs FastAPI, uvicorn, httpx, aiosqlite, etc.

**Verify:**
```bash
cd backend && source venv/bin/activate && python -c "import fastapi; print(f'FastAPI {fastapi.__version__} OK')" && cd ..
```

- [ ] Done — Shows "FastAPI x.x.x OK"

---

## Step 4 of 6 — Configure Environment

```bash
cp .env.example .env
```

Now edit `.env` and add your Serper API key:

```
SERPER_API_KEY=your_key_here
```

> **Where to get it:** Go to [serper.dev](https://serper.dev), sign up free, copy your API key.
> You get **2,500 free queries** — no credit card needed.
>
> **Alternative:** You can skip this and add the key later via the Settings gear icon in the UI.

**Verify:**
```bash
grep "SERPER_API_KEY" .env && echo "Env OK"
```

- [ ] Done — `.env` file exists with my key (or I'll add it via UI later)

---

## Step 5 of 6 — Load Chrome Extension

This extension auto-sends LinkedIn connection requests from the dashboard queue.

1. Open your browser:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`

2. Enable **Developer mode** (toggle in top-right corner)

3. Click **"Load unpacked"**

4. Select the `extension/` folder from this project

5. You should see **"LinkedIn Connection Sender"** appear in your extensions list

> **What it does:** Polls the backend for queued connections, opens LinkedIn in a background tab, and clicks "Send without a note" automatically.

**Verify:** The extension icon appears in your browser toolbar.

- [ ] Done — Extension loaded and visible

---

## Step 6 of 6 — Start the App

```bash
npm run dev
```

> **What this does:** Starts both backend (port 8000) and frontend (port 3000) simultaneously using `concurrently`.

**Open:** [http://localhost:3000](http://localhost:3000)

**Verify checklist:**
```
[ ] Dashboard loads with stats cards (Total Profiles, Connected, etc.)
[ ] Search panel shows default keywords
[ ] Settings gear icon works (slide-over panel opens)
[ ] Dark mode toggle works (moon/sun icon, top-right)
```

- [ ] Done — App is running!

---

## You're all set!

### Quick Reference

| Action | Command |
|--------|---------|
| Start everything | `npm run dev` |
| Start backend only | `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000` |
| Start frontend only | `cd frontend && npm run dev` |
| Run tests | `cd backend && source venv/bin/activate && pytest` |

### First Search

1. Click **Scan** (confirm the popup)
2. Watch profiles stream in real-time
3. Profile photos are fetched automatically
4. Use **Refresh Photos** for any missing ones

### Sending Connections

1. Click **Connect** dropdown on a profile row
2. Select **"Send Connection"**
3. Toast shows scheduled time
4. Chrome extension handles the rest automatically

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm run dev` fails | Make sure ports 3000 and 8000 are free: `lsof -i :3000` / `lsof -i :8000` |
| Backend import error | Ensure venv is activated: `source backend/venv/bin/activate` |
| No search results | Check API key in Settings (gear icon) or `.env` |
| Extension not working | Make sure it's enabled and you're on the dashboard page |
| Dark mode stuck | Open console: `localStorage.setItem('theme', 'light')` then refresh |
| Photos not loading | Some LinkedIn images expire — click **Refresh Photos** |

---

*Total setup time: ~5 minutes*
