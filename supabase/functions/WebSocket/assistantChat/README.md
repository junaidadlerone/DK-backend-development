# dk-assistant-chat

DoorKnocker+ AI assistant service (Tier 1). One Cloud Run service, two jobs:

1. **Notion → Pinecone KB sync** — durable Inngest function (`sync-notion-kb`), hourly cron
   `0 * * * *` + on-demand via event `kb/sync.requested` (`POST /admin/sync`). Ported from
   Kabuki Studio's production sync (chatKabuki) with fixes: `OPENAI_KEY` declared, DK+
   identifiers, and `last_edited_time` change detection (unchanged pages are not re-embedded).
2. **`POST /chat`** — built and E2E-verified (runbook §4): Supabase-JWT verify → Flowise Prediction API
   (Agentflow) → SSE `{delta}` / `{done, session_id}` / `{error}` → mirrors messages into
   `chat_sessions` / `chat_messages`.


## Location

`supabase/functions/WebSocket/assistantChat/` in **DK-backend-development** (the DoorKnocker+
backend repo), beside the other Cloud Run services (find/verify/discover addresses, postcard
sending sockets). The Kabuki reference implementations it was ported from live in
`ai_audiobook_backend/supabase/functions/WebSocket/` (`chatKabuki`, `namiGateway`).

## Deploy (senior dev)

```bash
# from this folder — same pattern as the Kabuki services
gcloud run deploy dk-assistant-chat --source . --region=europe-west1
```

Env vars (see `.env.example`): inject via Cloud Run env vars / GCP Secret Manager. Required for
the sync: `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `OPENAI_KEY`, `PINECONE_API_KEY`,
`PINECONE_INDEX_NAME`, `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `ADMIN_SYNC_SECRET`.

After each deploy that changes function config, **re-sync the app in Inngest Cloud**
(Apps → the `doorknocker` app → Resync, URL `https://<service-url>/api/inngest`).

## Local dev

```bash
cp .env.example .env   # fill in values
npm install
npm start              # → :8080  (GET /health, POST /admin/sync, /api/inngest)
npm run sync:local     # one-shot KB sync, no Inngest needed (first-time population / debugging)
```

## Endpoints

| Route | What |
|---|---|
| `GET /health`, `GET /` | health JSON |
| `POST /api/inngest` | Inngest serve (register this URL in Inngest Cloud) |
| `POST /admin/sync` (header `x-admin-secret`) | queue a KB sync now → 202 |
| `POST /chat` | SSE chat: JWT verify → Flowise Agentflow → {delta}/{done,session_id}/{error}; mirrors into chat_sessions/chat_messages |
