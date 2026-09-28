# CricGeek — Setup Cheat Sheet

**You do not need to know how to code to follow this.** Copy each block, paste it into a
terminal, press Enter, wait for it to finish, then move to the next one.

- Windows: press `Start`, type **PowerShell**, open it.
- Mac: press `Cmd+Space`, type **Terminal**, open it.

---

## TL;DR — the whole thing in 4 commands

Windows (PowerShell):

```powershell
git clone <YOUR_REPO_URL> cricgeek
cd cricgeek\cricgeek-app
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
npm run dev
```

Mac / Linux:

```bash
git clone <YOUR_REPO_URL> cricgeek
cd cricgeek/cricgeek-app
bash scripts/setup.sh
npm run dev
```

Then open **http://localhost:3000**.

The setup script installs everything, creates your `.env`, and generates a login secret.
It will tell you if it still needs a database URL from you. The rest of this page is the
same thing, step by step, plus what to do when something goes wrong.

---

## STEP 0 — Install the two things you need

### Node.js (required)

Download the **LTS** version from <https://nodejs.org> and install it with all defaults.
Close and reopen your terminal afterwards, then check it worked:

```bash
node --version
```

You should see `v20.x.x` or higher. If you see "command not found", the install did not
finish — reinstall and reopen the terminal.

### Git (required, to download the code)

- Windows: <https://git-scm.com/download/win> — install with all defaults.
- Mac: already installed. If not, run `xcode-select --install`.

```bash
git --version
```

### A SQL Server database (required)

The app stores everything in Microsoft SQL Server. Pick **one**:

| Option | Best for | How |
|---|---|---|
| **Docker** (easiest) | Local development | See the command below |
| SQL Server Express | Windows, no Docker | <https://www.microsoft.com/sql-server/sql-server-downloads> (pick Express) |
| Azure SQL | Cloud / production | Create a SQL Database in the Azure portal |

Docker one-liner (install Docker Desktop first from <https://docker.com>):

```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=CricGeek!2026" -p 1433:1433 --name cricgeek-db -d mcr.microsoft.com/mssql/server:2022-latest
```

That gives you a database at `localhost:1433` with user `sa` and password `CricGeek!2026`.

To create the database inside it:

```bash
docker exec -it cricgeek-db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "CricGeek!2026" -C -Q "CREATE DATABASE cricgeek"
```

If the container stops, start it again with `docker start cricgeek-db`.

---

## STEP 1 — Download the code

```bash
git clone <YOUR_REPO_URL> cricgeek
cd cricgeek/cricgeek-app
```

On Windows use a backslash: `cd cricgeek\cricgeek-app`.

Every command from here on runs **inside the `cricgeek-app` folder**. If a command fails
with "file not found", you are probably in the wrong folder — run `dir` (Windows) or
`ls` (Mac) and check you can see `package.json`.

---

## STEP 2 — Run the setup script

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

Mac / Linux:

```bash
bash scripts/setup.sh
```

This takes a few minutes. It will:

1. check your Node.js version
2. install all dependencies
3. create `.env` from `.env.example`
4. generate a random `AUTH_SECRET` for you
5. generate the database client
6. create all the database tables
7. run an offline self-test of the scoring engine

**If you would rather do it by hand**, these are the same steps:

```bash
npm install
cp .env.example .env          # Windows: Copy-Item .env.example .env
npm run db:push
```

---

## STEP 3 — Fill in your `.env` file

Open `.env` in Notepad (Windows) or TextEdit (Mac). You only *have* to change one line.

### Required

```ini
DATABASE_URL="sqlserver://localhost:1433;database=cricgeek;user=sa;password=CricGeek!2026;encrypt=true;trustServerCertificate=true"
```

Replace the password with your own. If you used the Docker command above, the line
works as written.

`AUTH_SECRET` was filled in for you by the setup script. If it is empty, generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the output between the quotes.

### Strongly recommended (free tiers available)

The app runs without these, but these features stay switched off:

| Variable | Get it from | Without it |
|---|---|---|
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> | EQS falls back to a weaker local model or plain heuristics |
| `SPORTMONKS_API_TOKEN` | <https://www.sportmonks.com/cricket-api> | No real fixtures or live scores; EQS cannot verify stats against a scorecard |
| `DEEPGRAM_API_KEY` | <https://console.deepgram.com> | Voice-to-Commentary cannot transcribe |
| `TAVILY_API_KEY` | <https://tavily.com> | EQS cannot fact-check claims the scorecard does not cover |

After editing `.env`, **save the file** and restart the app.

---

## STEP 4 — Start the app

```bash
npm run dev
```

Leave this terminal window open — closing it stops the app.

Open **<http://localhost:3000>** in your browser.

To stop the app, click the terminal and press `Ctrl+C`.

---

## STEP 5 — Check everything is wired up

Open **<http://localhost:3000/api/health>** in your browser.

You will see a block of JSON. The useful bits:

| Field | Should say | If it does not |
|---|---|---|
| `checks.database` | `true` | Your `DATABASE_URL` is wrong or SQL Server is not running |
| `checks.eqsReady` | `true` | Set `GEMINI_API_KEY`, or run Ollama locally |
| `checks.eqsSchemaReady` | `true` | Run `npm run db:push` |
| `checks.eqsPrimaryProvider` | `gemini` | `heuristic` means no AI model is configured |
| `checks.eqsStatVerificationReady` | `true` | Set `SPORTMONKS_API_TOKEN` or `TAVILY_API_KEY` |
| `checks.voiceReady` | `true` | Set `DEEPGRAM_API_KEY` |
| `checks.matchDataConfigured` | `true` | Set `SPORTMONKS_API_TOKEN` |

`ok: false` at the top just means one of the three core checks is off — the page still
loads and tells you which.

---

## Every command you might need

Run all of these from `cricgeek-app`.

### Day to day

```bash
npm run dev            # start the app at http://localhost:3000
npm run build          # production build (also catches type errors)
npm start              # run the production build (after npm run build)
npm run lint           # check code style
npm run typecheck      # check types without building
```

### Database

```bash
npm run db:push        # create/update all tables from prisma/schema.prisma
npm run db:studio      # open a visual database browser at localhost:5555
npx prisma generate    # regenerate the database client after schema changes
```

### EQS (the scoring engine)

```bash
npm run eqs:selftest   # offline check of the scoring maths — needs no keys, no database
npm run eqs:migration  # regenerate prisma/eqs_migration.sql from the DDL source
```

### Reinstall from scratch if something is broken

Windows:

```powershell
Remove-Item -Recurse -Force node_modules, .next
npm install
npm run db:push
```

Mac / Linux:

```bash
rm -rf node_modules .next
npm install
npm run db:push
```

---

## Trying the EQS API

With the app running (`npm run dev`), open a **second** terminal.

Score a draft:

```bash
curl -X POST http://localhost:3000/api/ai/eqs -H "Content-Type: application/json" -d "{\"title\":\"Test\",\"content\":\"Jasprit Bumrah barely bowled a yorker tonight, and that is exactly why the chase collapsed. He bowled the hard length into the surface and kept dragging the batters across the crease. Between overs eleven and sixteen the false-shot rate climbed because nobody could get under the ball.\"}"
```

Other endpoints (sign-in required; the last three are admin only):

```bash
# Score a saved post and store the full audit trail
curl -X POST http://localhost:3000/api/eqs/run -H "Content-Type: application/json" -d "{\"blogId\":\"<BLOG_ID>\"}"

# Read back a stored score with its evidence
curl http://localhost:3000/api/eqs/<BLOG_ID>

# Effective config, model versions, weights and thresholds  (admin)
curl http://localhost:3000/api/eqs/config

# Posts the pipeline routed to a human                      (admin)
curl http://localhost:3000/api/eqs/review-queue

# Dataset coverage — no scoring, no cost
curl "http://localhost:3000/api/eqs/benchmark?coverage=1"

# Calibration benchmark                                      (admin, costs API calls)
curl "http://localhost:3000/api/eqs/benchmark?limit=10&fast=1"
```

---

## Optional: run the AI model locally instead of using Gemini

If you would rather not use a cloud API key, install Ollama from <https://ollama.com>,
then:

```bash
ollama pull qwen3:latest
ollama serve
```

Set these in `.env`:

```ini
OLLAMA_URL="http://localhost:11434"
OLLAMA_MODEL="qwen3:latest"
OLLAMA_BQS_MODEL="qwen3:latest"
```

Leave `GEMINI_API_KEY` empty and the pipeline uses Ollama automatically.

---

## Optional: the Python side-services

The app runs fine without these. They only power the advanced match-insights pages.

```bash
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Mac / Linux:
source .venv/bin/activate

pip install -r requirements.txt
npm run dev:insights          # starts on http://127.0.0.1:8010
```

Then set `INSIGHTS_URL="http://127.0.0.1:8010"` in `.env`.

---

## When something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| `'npm' is not recognized` | Node.js is not installed, or the terminal is stale | Install Node.js LTS, close and reopen the terminal |
| `Cannot find module '@prisma/client'` | The database client was never generated | `npx prisma generate` |
| `unable to get local issuer certificate` during `prisma generate` | A corporate network is blocking `binaries.prisma.sh` | Ask IT to allow that host, or set `HTTPS_PROXY`. The app still runs; EQS creates its own tables at runtime |
| `Can't reach database server` | SQL Server is not running, or `DATABASE_URL` is wrong | Start the database (`docker start cricgeek-db`), re-check the URL |
| `Login failed for user 'sa'` | Wrong password in `DATABASE_URL` | Fix the password; it must match the one you set when creating the database |
| `Invalid object name 'dbo.Blog'` | Tables were never created | `npm run db:push` |
| `EADDRINUSE: port 3000` | Something else is on port 3000 | `npm run dev -- -p 3001`, then use `localhost:3001` |
| Port 5555 busy on `db:studio` | Studio already running | Close the other tab, or `npx prisma studio --port 5556` |
| EQS scores look flat, all around 60 | No AI model configured, so the deterministic fallback is scoring | Set `GEMINI_API_KEY`, or run Ollama. Check `/api/health` → `eqsPrimaryProvider` |
| Stat claims never verified | No cricket data source configured | Set `SPORTMONKS_API_TOKEN`, and link a post to a match when publishing |
| Voice-to-text returns 503 | No transcription provider | Set `DEEPGRAM_API_KEY` |
| Blank page, console shows chunk errors | Stale build cache | Delete the `.next` folder and run `npm run dev` again |

---

## Where things live

```
cricgeek-app/
├── .env.example              # every setting, documented — copy to .env
├── SETUP.md                  # this file
├── prisma/
│   ├── schema.prisma         # the database design
│   └── eqs_migration.sql     # EQS tables (generated; applied automatically at runtime)
├── scripts/
│   ├── setup.ps1 / setup.sh  # the one-shot installer
│   └── eqs-selftest.mts      # offline scoring-engine check
├── src/
│   ├── app/api/              # backend endpoints
│   ├── lib/eqs/              # the EQS pipeline
│   └── lib/voice/            # Voice-to-Commentary
└── docs/
    ├── 10-EQS.md             # how EQS works
    └── 11-VOICE-TO-COMMENTARY.md
```

---

## Deploying to production

1. Push your code to GitHub.
2. Import the repo at <https://vercel.com>.
3. Add every variable from `.env` under **Project Settings → Environment Variables**.
4. Set `AUTH_URL` to your real domain and `ALLOW_MOCK_MATCH_DATA=false`.
5. Apply the schema to the production database: `npx prisma db push`.
6. Deploy, then open `https://your-domain.com/api/health` and confirm the checks.

Full detail in [`docs/PRODUCTION_SETUP.md`](docs/PRODUCTION_SETUP.md).
