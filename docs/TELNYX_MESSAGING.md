# Telnyx SMS setup (Flowcheq CRM)

This backend sends and receives SMS through [Telnyx Messaging API](https://developers.telnyx.com/docs/messaging/messages/send-message).

## Architecture

```
Frontend (messaging.flowcheq.com)
    POST /api/messages/send  ──►  Backend (api.flowcheq.com)
                                        │
                                        ▼
                              Telnyx POST /v2/messages
                                        │
Inbound SMS ◄─────────────────────────┘
    Telnyx webhook POST /webhook/inbound
```

## 1. Telnyx portal setup

### API key

1. Open [Telnyx Portal → API Keys](https://portal.telnyx.com/#/app/api-keys).
2. Create or copy an API key with **Messaging** permissions.
3. Set `TELNYX_API_KEY` in the backend environment.

### Phone number

1. Go to **Numbers → Search & Buy**.
2. Filter by **SMS** capability and purchase a number (e.g. `+16563001897`).
3. Set `TELNYX_PHONE_NUMBER` to that E.164 value.

### Messaging profile

1. Go to **Messaging → Messaging Profiles → Add new profile** (e.g. `flowcheq-sms`).
2. Open the profile and set **Webhook URL** to your public backend URL:

   ```
   https://api.flowcheq.com/webhook/inbound
   ```

   For local testing with a tunnel (ngrok, Cloudflare Tunnel):

   ```
   https://YOUR-TUNNEL.example/webhook/inbound
   ```

3. Enable webhook for **Inbound message received** (`message.received`).
4. Copy the profile ID from the portal (or from the profile URL) and set:

   ```
   TELNYX_MESSAGING_PROFILE_ID=<profile-id>
   ```

5. Assign your number to this profile: **Numbers → My Numbers → [your number] → Messaging Profile**.

### US compliance (10DLC / toll-free)

Sending SMS to US mobile numbers from a US long code usually requires **10DLC** brand and campaign registration in Telnyx. Toll-free numbers need **TF verification**.

- **Telnyx-to-Telnyx** tests between two Telnyx numbers work without registration.
- For production US outbound, complete registration under **Messaging → Campaigns** in the portal.

## 2. Backend environment

Copy `envsample.txt` to `.env` (or set vars in Coolify):

| Variable | Required | Description |
|----------|----------|-------------|
| `TELNYX_API_KEY` | Yes | Telnyx API key |
| `TELNYX_PHONE_NUMBER` | Yes | E.164 sender (must be on messaging profile) |
| `TELNYX_MESSAGING_PROFILE_ID` | Recommended | Links sends to profile + webhook config |
| `APP_URL` or `TELNYX_WEBHOOK_BASE_URL` | Yes (prod) | Public base URL for webhook docs/health |
| `MONGODB_URI` | Yes | Message storage |

Example:

```env
APP_URL=https://api.flowcheq.com
TELNYX_API_KEY=KEY...
TELNYX_PHONE_NUMBER=+16563001897
TELNYX_MESSAGING_PROFILE_ID=40000000-0000-0000-0000-000000000000
```

Verify config after deploy:

```bash
curl https://api.flowcheq.com/api/health
```

Expected fields:

```json
{
  "telnyxSms": true,
  "inboundWebhook": "https://api.flowcheq.com/webhook/inbound"
}
```

If `TELNYX_API_KEY` is missing, the backend runs in **simulator mode** (no real SMS).

## 3. How to send a message

### Option A — Flowcheq inbox UI

1. Start frontend (`yarn dev`) and backend (`cd backend && yarn dev`).
2. Open a conversation or create a contact with a valid E.164 phone (`+1...`).
3. Type a message and send — the UI calls `POST /api/messages/send`.

### Option B — Backend API

```bash
curl -X POST https://api.flowcheq.com/api/messages/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+15551234567",
    "content": "Hello from Flowcheq!"
  }'
```

Or with an existing conversation:

```json
{
  "conversationId": "chat_abc123",
  "content": "Hello!"
}
```

The route resolves the contact, creates a conversation if needed, calls Telnyx, and stores the outbound message in MongoDB.

Implementation: `src/routes/messages.ts` → `SMSService.sendMessage()` → `POST https://api.telnyx.com/v2/messages`.

### Option C — Telnyx API directly (smoke test)

Use this to confirm Telnyx credentials before debugging the app:

```bash
curl -X POST https://api.telnyx.com/v2/messages \
  -H "Authorization: Bearer YOUR_TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+16563001897",
    "to": "+15559876543",
    "text": "Hello, world!"
  }'
```

Optional: add `"messaging_profile_id": "YOUR_PROFILE_ID"`.

## 4. Receiving inbound SMS

Telnyx POSTs to `/webhook/inbound` when `message.received` fires.

Handler flow:

1. `src/routes/webhooks.ts` — detects Telnyx `message.received`
2. `SMSService.normalizeInbound()` — extracts from/to/text
3. `handleInboundSMS()` — upserts contact, conversation, message, notification

Test inbound by texting your Telnyx number from a mobile phone (after webhook URL is reachable from the internet).

## 5. Local development

| Issue | Workaround |
|-------|------------|
| MongoDB Atlas blocked on your network | Use Coolify backend, VPN, or local MongoDB |
| Telnyx cannot reach `localhost` | Use ngrok/Cloudflare Tunnel; set `TELNYX_WEBHOOK_BASE_URL` to tunnel URL and update messaging profile webhook |
| No API key | Set `SMS_SIMULATE_REPLIES=true` for fake inbound replies |

## 6. Troubleshooting

| Symptom | Check |
|---------|--------|
| `403` / `invalid phone number` | Number not assigned to messaging profile |
| `400` / campaign / 10DLC errors | Complete US registration or test Telnyx-to-Telnyx |
| Outbound works, no inbound | Webhook URL wrong or not HTTPS; profile not assigned to number |
| `telnyxSms: false` in health | Missing `TELNYX_API_KEY` or `TELNYX_PHONE_NUMBER` |
| ECONNREFUSED on frontend | Backend not running; fix `APP_URL` / proxy target |

Telnyx error bodies are surfaced in backend logs via `SMSService` (code, title, detail).

## References

- [Send your first message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging profiles](https://developers.telnyx.com/docs/messaging/messaging-profiles)
- [Webhooks](https://developers.telnyx.com/docs/v2/messaging/webhooks)
