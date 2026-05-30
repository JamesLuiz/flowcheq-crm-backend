# Flowcheq Backend

Express API for the Flowcheq frontend. Handles contacts, conversations, SMS (Telnyx), calls, WebRTC tokens, and n8n voice webhooks. All secrets live in `.env` at the repo root — the frontend never reads env vars.

## Run standalone

```bash
cp .env.example ../.env   # or cp backend/.env.example ../.env
npm run dev:backend       # http://localhost:3000
```

## Run with frontend (dev)

```bash
npm run dev
```

Starts backend on `:3000` and Vite on `:5173` (frontend proxies `/api` → backend).

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check |
| GET/POST | `/api/contacts` | Contact CRUD |
| GET | `/api/conversations` | Inbox list |
| POST | `/api/messages/send` | Send SMS via Telnyx |
| POST | `/api/calls/outbound` | Start outbound call via Telnyx |
| POST | `/webhook/inbound` | Telnyx SMS webhook |
| POST | `/api/webhook/voice/call-started` | n8n → incoming call notification |
| POST | `/api/webhook/voice/call-completed` | n8n → AI/human call summary |

Voice webhooks require header `x-api-key: WEBHOOK_SECRET`.

## Environment

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Public backend URL (Telnyx SMS webhooks, n8n → Flowcheq) |
| `FRONTEND_URL` | CORS origin for browser dev (default `http://localhost:5173`) |
| `MONGODB_URI` | Shared with ai-voice-system |
| `TELNYX_*` | SMS + voice + WebRTC |
| `WEBHOOK_SECRET` | n8n voice webhook auth |

See `backend/.env.example` for the full list.

## Telnyx setup

1. **SMS** — Messaging profile webhook → `https://YOUR-API/webhook/inbound`
2. **Voice** — Call Control webhook → `https://YOUR-N8N/webhook/telnyx/events`
3. Set `TELNYX_API_KEY`, `TELNYX_PHONE_NUMBER`, `TELNYX_CONNECTION_ID` in `.env`
4. Set `FLOWCHEQ_API_URL` to the **backend** URL and `FLOWCHEQ_WEBHOOK_SECRET` in n8n
