# Saksham — voice-first livelihood mapping and skilling assistant

> **Talk. Learn a skill. Earn.**

Built for **Smart India Hackathon 2026, problem statement SIH26097**: *AI-driven voice assistant for livelihood mapping and NSQF-aligned skilling recommendations for SC communities, under the GIA component of PM-AJAY (Ministry of Social Justice and Empowerment).*

Saksham replaces the usual sign-up form with a short spoken interview in **Hindi or English**. It builds a profile from the answers, matches the person to **NSQF-aligned courses with reasons**, shows what work is in demand in their state, and can hand them to a counsellor.

**Live demo (AWS, HTTPS):** https://saksham-vaish.duckdns.org
**Also deployed on Vercel:** https://government-scheme-bice.vercel.app

<table>
  <tr>
    <td align="center"><img src="docs/01-voice-interview.png" width="220" alt="Voice interview screen"/><br/><sub>1. Speak, or type</sub></td>
    <td align="center"><img src="docs/02-understood-and-matches.png" width="220" alt="What we understood and ranked matches"/><br/><sub>2. Read-back and ranked matches</sub></td>
    <td align="center"><img src="docs/03-course-detail.png" width="220" alt="Course detail with reasons and next level"/><br/><sub>3. Why this course, what's next</sub></td>
  </tr>
</table>

---

## The problem

Skilling programmes exist, but matching people to the right course is weak. Under PMKVY 1.0–3.0, about 56.89 lakh people were certified and more than half have no reported placement (MSDE reply in Lok Sabha, via PIB). A learner who cannot fill in forms, or does not know which course fits, is often left behind.

## Features

**Voice interview**
- Spoken interview in **Hindi and English**, one simple question at a time, with a progress bar
- Tap-to-speak with a **typed fallback** and a **Skip** option
- Every question can be read aloud

**Profile and read-back**
- Answers are turned into a profile (state, age, education, family work, current activity, interests, mobility, employment preference, local work)
- **"What we understood"** read-back screen where the person can **correct** anything that is wrong
- **Read all aloud** for people who cannot read comfortably

**NSQF-aligned matches**
- Ranked course matches with **NSQF level** and **duration**
- A plain-language **reason** for each match: demand in the person's state, whether it leads to a salaried job, and whether their education qualifies
- **Skills you will add** and the **next NSQF level** after the course
- **Where this leads**, **support you may get** (government schemes) and **where to train**
- **Work that is common in your state** and **documents to keep ready**

**Counsellor handoff**
- Opt-in: the person ticks consent to share their *answers (not their voice)* with a counsellor and can leave an optional phone number for a call back

**Officer dashboard**
- Key-protected view at `/officer` for district officers (demand, skill gaps, counsellor queue)

**Also included**
- Account sign-up and login
- Scheme discovery with eligibility checking and short lessons (seeded sample content)
- Installable **PWA** with an *Install app* button
- Optional **Twilio WhatsApp and IVR channels** using the same interview and recommendation engine. See [Optional phone and WhatsApp channels](#optional-phone-and-whatsapp-channels) for setup.

## Live job-market demand (SerpApi)

Saksham recommends courses partly on "how much work there is for this trade in your state". That signal used to come from a hand-made table (`backend/src/livelihood/demand.js`). It now also comes from **real, recent job listings**, fetched with [SerpApi](https://serpapi.com/)'s **Google Jobs** engine.

**What the person sees.** On a course card, under "Where it leads", Saksham shows how many recent listings were found for that trade in their state (for example "Recent job listings found: 10+"), one example listing, and the source. The same fact appears as a plain sentence in the "why this matches you" list, which the app can read aloud in Hindi or English. A trade with strong live evidence can also rank higher.

**How it works**
1. When an interview result is requested (`POST /api/livelihood/recommend`), the server picks up to 4 trades that matter for this person (what they said first, then the state's usual top trades).
2. For each, it runs one SerpApi search such as `tailor jobs in Bihar` (`engine=google_jobs`, India). Google Jobs returns at most 10 listings per page, so the count is "0 to 10, where 10 means 10 or more".
3. The count becomes a demand level: 8 or more is high (3), 4 to 7 is steady (2), fewer is low (1).
4. The recommender gets this as a snapshot. It is still a pure function: the same profile and the same snapshot always give the same answer.

**Design choices**
- **Raise-only blending.** Live listings can lift a trade's demand level but never lower it. Google Jobs under-represents informal work (farming, dairy, handicraft, weaving), so a thin result is not proof of low demand.
- **Additive and safe.** With no `SERPAPI_API_KEY`, `SERPAPI_ENABLED=false`, an unknown state, a timeout, a quota error or a database error, the app falls back to the static table. With no key the recommender output is identical to before (checked against 3,000 generated results).
- **Frugal.** Results are cached per state and trade for `SERPAPI_CACHE_DAYS` (default 7), identical concurrent lookups share one call, and a hard monthly cap (`SERPAPI_MONTHLY_BUDGET`, default 200) is counted in the database. Old cached results are reused when the cap is reached.
- **Never slow.** A request waits at most `SERPAPI_DEADLINE_MS` (default 3500). Lookups still running keep going in the background and fill the cache for the next person.
- **Privacy.** Only generic queries (trade and state) leave the server. Nothing from the interview, no audio and no contact details are sent to SerpApi, and the cache holds public listing counts only. The phone and WhatsApp channels are unchanged and keep using the static table.

**Try it**
```bash
cd backend
# put SERPAPI_API_KEY=... in .env  (free key: https://serpapi.com/, 250 searches a month)
npm run check:serpapi                       # one real search (uses 1 credit): tailor jobs in Bihar
npm run check:serpapi -- electrician Kerala
npm test                                    # unit tests, no network or database needed
```
Officers can check usage at `GET /api/livelihood/live-status` (send the `x-officer-key` header).

**Where the SerpApi work lives**
`backend/src/serpapi/client.js` (API client), `backend/src/livelihood/liveDemand.js` (blending, cache, budget, fallbacks), `backend/src/livelihood/liveStore.js` and `backend/src/models/LiveDemand.js`, `SerpApiUsage.js` (storage), small additive changes in `recommend.js` and `livelihoodController.js`, the course card in `frontend/src/components/CourseCard.jsx`, and tests in `backend/test/`.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Tailwind CSS, PWA |
| Speech | Browser Web Speech API (speech-to-text and text-to-speech) |
| Backend | Node.js, Express, Sequelize |
| Database | PostgreSQL |
| Live job data | SerpApi (Google Jobs engine), cached in PostgreSQL |
| Deployment | Docker Compose, nginx, AWS EC2, Let's Encrypt HTTPS, GitHub Actions, Vercel |

## How it fits together

```
Browser (React PWA)
      │  https
      ▼
nginx (container, ports 80/443)  ──►  serves the built React app
      │  /api/*
      ▼
Express API (container, port 5000)
      │
      ▼
PostgreSQL (container, volume pgdata)
```

Useful routes: `/` home, `/assistant` voice interview, `/officer` officer dashboard.
API examples: `GET /api/livelihood/meta` (trades, education levels, states, questions), `POST /api/livelihood/turn` (one interview turn), `GET /health`.

### API overview

**Livelihood assistant** (`/api/livelihood`):
- `GET /meta` and `GET /catalog` — interview metadata and course catalogue
- `POST /turn` and `POST /recommend` — process an interview answer and get ranked recommendations
- `DELETE /sessions/:id` — delete the caller's saved session
- `GET /dashboard`, `GET /sessions` and `PATCH /sessions/:id` — officer-only dashboard and session management; send the `x-officer-key` header matching `OFFICER_KEY`
- `GET /live-status` — officer-only: whether live job data is on and how much of the monthly SerpApi budget is used

**Twilio channels** (`/api/channels`): `POST /voice/incoming`, `/voice/language`, `/voice/gather`, `/voice/consent`, and `/whatsapp/incoming`. Configure as described in [Optional phone and WhatsApp channels](#optional-phone-and-whatsapp-channels).

The earlier account-based app is also present: `/home`, `/lessons`, and `/profile`, backed by `/api/auth`, `/api/schemes`, `/api/lessons`, `/api/eligibility`, and `/api/sync`.

## Run it locally

You need Node.js 18+, npm and a PostgreSQL database.

```bash
git clone https://github.com/vaish1409/government-scheme.git
cd government-scheme

# 1) Backend
cd backend
npm install
cp .env.example .env      # fill in your database settings and a JWT secret
npm run dev               # http://localhost:5000

# 2) Frontend (new terminal)
cd ../frontend
npm install
cp .env.example .env      # set VITE_API_URL=http://localhost:5000
npm run dev               # http://localhost:5173
```

Load the sample schemes, lessons and demo sessions with `npm run seed` in `backend/`. The seed script loads 7 schemes, 3 lessons and 150 synthetic livelihood sessions for demonstration; scheme eligibility rules are simplified and lesson media URLs are placeholders. Verify official scheme criteria before relying on them.

> Browsers only allow the microphone on secure pages. Voice works on `http://localhost` and on HTTPS sites, but not on a plain `http://` IP address. Use the typed fallback in that case.

## Environment variables

Copy `.env.example` to `.env` (never commit `.env`).

| Variable | Purpose |
|---|---|
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL credentials |
| `JWT_SECRET` | Secret used to sign login tokens (generate with `openssl rand -hex 32`) |
| `CLIENT_URL` | Public URL of the app, for example `https://your-domain` |
| `OFFICER_KEY` | Password for the officer dashboard |
| `TWILIO_*`, `OPENAI_API_KEY` | Optional integrations; leave blank if unused |
| `SERPAPI_API_KEY` | Optional. Turns on live job listings; leave blank to use the static demand table. Also `SERPAPI_ENABLED`, `SERPAPI_CACHE_DAYS`, `SERPAPI_MONTHLY_BUDGET`, `SERPAPI_MAX_TRADES_PER_REQUEST`, `SERPAPI_DEADLINE_MS` (see `.env.example`) |

## Deployment

Production runs on a single **AWS EC2** instance with **Docker Compose**:

- `postgres` — PostgreSQL 16 with a persistent volume
- `backend` — the Express API
- `frontend` — nginx serving the React build, proxying `/api/` to the backend, and terminating **HTTPS** with a free **Let's Encrypt** certificate (renewed automatically)

```bash
cp .env.example .env            # fill in real values
docker compose up -d --build
docker compose exec backend npm run seed   # first time only
```

`frontend/nginx.conf` is written for the production domain and expects the certificate files under `/etc/letsencrypt`. For local development use the steps in *Run it locally*, or adjust `nginx.conf`.

**CI/CD:** every push to `master` triggers `.github/workflows/deploy.yml`, which connects to the server over SSH, pulls the latest code and rebuilds the containers. It uses the repository secrets `EC2_SSH_KEY`, `EC2_HOST` and `EC2_USER`.

The frontend is also deployed on **Vercel**. There, `VITE_API_URL` points at the backend. On the AWS deployment it is left empty so the app calls the same origin at `/api`.

### Optional phone and WhatsApp channels

The backend includes Twilio webhooks for phone (IVR) interviews and WhatsApp text or voice-note interviews. To try them, configure `PUBLIC_BASE_URL`, `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in `backend/.env`, then configure your Twilio phone number to POST calls to `/api/channels/voice/incoming` and your WhatsApp sender to POST messages to `/api/channels/whatsapp/incoming` on that public HTTPS backend. WhatsApp voice-note transcription additionally requires `OPENAI_API_KEY`; without it, ask the person to type their answer. These channels require a configured Twilio account and are not needed for the web app.

## Project structure

```
backend/                 Express API, Sequelize models, seed scripts, Dockerfile
frontend/                React + Vite app, nginx.conf, Dockerfile
docker-compose.yml       postgres + backend + frontend
.github/workflows/       CI/CD pipeline
docs/                    README screenshots
```

## Roadmap

- More regional languages
- Counsellor check-ins and placement tracking after training
- Real district demand data feeds for the officer dashboard

## Team

**Team Surang** — Smart India Hackathon 2026 · maintained by [@vaish1409](https://github.com/vaish1409)
