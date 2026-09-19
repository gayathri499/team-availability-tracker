# Team Availability Tracker

A real-time dashboard where a team toggles their status between **Available**, **Busy** and **Away**. Every change is written to a SQLite database and pushed to all connected browsers over WebSocket.

## Stack

- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`)
- **Live updates:** `ws` WebSocket server, with a 5-second polling fallback if the socket drops
- **Frontend:** vanilla HTML/CSS/JS — no build step

## Running locally

```bash
npm install
npm start
```

Open http://localhost:3000. The database is created at `data/availability.db` on first run and seeded with four example teammates.

Open the page in two browser windows and toggle a status in one — the other updates instantly.

## Database schema

**members**

| column | type | notes |
| --- | --- | --- |
| id | INTEGER | primary key, autoincrement |
| name | TEXT | required |
| role | TEXT | optional |
| status | TEXT | `available` \| `busy` \| `away`, CHECK-constrained |
| note | TEXT | optional free-text note on the status |
| created_at | TEXT | set on insert |
| updated_at | TEXT | refreshed on every status change |

**status_history** — append-only audit trail

| column | type | notes |
| --- | --- | --- |
| id | INTEGER | primary key |
| member_id | INTEGER | FK → members.id, cascade delete |
| status | TEXT | the status that was set |
| changed_at | TEXT | timestamp |

## REST API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness check |
| GET | `/api/members` | All members plus a status summary |
| GET | `/api/members/:id` | One member plus their recent status history |
| POST | `/api/members` | Add a member — `{ name, role?, status? }` |
| PATCH | `/api/members/:id/status` | Change status — `{ status, note? }` |
| PATCH | `/api/members/:id` | Rename or change role — `{ name?, role? }` |
| DELETE | `/api/members/:id` | Remove a member |

Every write broadcasts the updated board to all WebSocket clients.

Example:

```bash
curl -X PATCH http://localhost:3000/api/members/1/status \
  -H "Content-Type: application/json" \
  -d '{"status":"busy"}'
```

## WebSocket

Connect to `/ws`. On connect and after every write the server sends:

```json
{ "type": "board", "members": [...], "summary": { "available": 2, "busy": 1, "away": 1 }, "at": "..." }
```

## Deploying

The app reads `PORT` from the environment, so it works as-is on most hosts.

**Render / Railway / Fly.io**
- Build command: `npm install`
- Start command: `npm start`
- Attach a persistent disk mounted at `/data` and set `DATA_DIR=/data` so the database survives restarts. Without a disk the SQLite file resets on each deploy.

**Docker**

```bash
docker build -t availability-board .
docker run -p 3000:3000 -v $(pwd)/data:/app/data availability-board
```

## Pushing to GitHub

```bash
git init
git add .
git commit -m "Team availability tracker"
git branch -M main
git remote add origin https://github.com/<you>/team-availability-tracker.git
git push -u origin main
```

## Notes

There's no authentication — anyone who can reach the page can change anyone's status. That's deliberate for an internal team board, but add auth before putting it on the public internet.
