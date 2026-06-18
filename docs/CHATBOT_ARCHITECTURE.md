# DoorKnocker Chatbot — Architecture

> **Status:** Tier 1 live. Tier 2/3 schema and tool registry ready for activation.

---

## Table of Contents

1. [Overview](#overview)
2. [Tier System](#tier-system)
3. [Tech Stack](#tech-stack)
4. [High-Level Architecture](#high-level-architecture)
5. [Request Flow (Per Message)](#request-flow-per-message)
6. [Knowledge Base Pipeline](#knowledge-base-pipeline)
7. [Database Schema](#database-schema)
8. [Frontend Components](#frontend-components)
9. [Review Flow](#review-flow)
10. [Tier 2 / Tier 3 Upgrade Path](#tier-2--tier-3-upgrade-path)
11. [Cost Estimate](#cost-estimate)
12. [Secrets & Config](#secrets--config)

---

## Overview

DoorKnocker includes a floating in-app support chatbot powered by **OpenAI GPT-4o-mini** and **Retrieval Augmented Generation (RAG)** over a Supabase pgvector knowledge base.

**What it does (Tier 1 — live):**
- Answers questions about the app using the embedded knowledge base
- Maintains per-user conversation history across sessions
- Asks for a star rating + comment after 6+ exchanges

**What it will do (Tier 2/3 — architecture ready):**
- Navigate users to specific pages on their behalf
- Perform write actions (create campaigns, manage zones) with confirmation
- Run multi-step agentic workflows

RAG works like this: instead of relying on what GPT already knows (which is nothing about DoorKnocker), we:
1. Write plain-English docs about the app
2. Convert them to number vectors (embeddings) that represent meaning
3. Store those vectors in Supabase pgvector
4. At query time, find the docs most similar to the user's question and inject them into the GPT prompt
5. GPT answers using **your docs only** — no hallucination about features that don't exist

---

## Tier System

```mermaid
graph LR
    T1["🟢 Tier 1 — ACTIVE\nKnowledge Q&A\nRAG-powered answers\nReview collection"]
    T2["🟡 Tier 2 — READY\nNavigation actions\nnavagate_to_page tool\nrequest_confirmation gate"]
    T3["🔵 Tier 3 — PLANNED\nAgentic workflows\nMulti-step loops\nCreate campaigns, manage zones"]

    T1 -->|"flip ACTIVE_TOOLS\nin _shared/chatTools.ts"| T2
    T2 -->|"add tool handlers\nin chat/index.ts"| T3

    style T1 fill:#d4edda,stroke:#28a745,color:#000
    style T2 fill:#fff3cd,stroke:#ffc107,color:#000
    style T3 fill:#cce5ff,stroke:#004085,color:#000
```

| Tier | `ACTIVE_TOOLS` value | Change needed |
|---|---|---|
| 1 (now) | `TIER_1_TOOLS` (empty array) | — |
| 2 | `TIER_2_TOOLS` | Flip one export in `_shared/chatTools.ts` + add handler cases |
| 3 | Custom multi-step tools | Extend agent loop with `while (finish_reason === "tool_calls")` |

---

## Tech Stack

| Layer | Service | Model / Plan | Cost |
|---|---|---|---|
| LLM | OpenAI Chat | `gpt-4o-mini` | ~$0.15/M input, $0.60/M output |
| Embeddings | OpenAI Embeddings | `text-embedding-3-small` (1536-dim) | ~$0.02/1M tokens |
| Vector DB | Supabase pgvector | HNSW index, cosine similarity | $0 (within plan) |
| Chat history | Supabase Postgres | `chat_sessions`, `chat_messages` | $0 (within plan) |
| Reviews | Supabase Postgres | `reviews` table | $0 (within plan) |
| Backend logic | Supabase Edge Functions | Deno runtime | $0 (within free limits) |
| Streaming | Server-Sent Events (SSE) | — | — |
| Knowledge base | Markdown files in repo | 44 docs / 178 chunks | $0 |
| Optional review sync | Notion API | Requires `NOTION_TOKEN` + `NOTION_DATABASE_ID` | $0 |
| Frontend | React + Vite | Custom hooks + components | $0 |

---

## High-Level Architecture

```mermaid
graph TB
    subgraph Frontend ["Frontend — React App (Vite)"]
        CW["ChatWidget\n(floating button)"]
        CD["ChatDrawer\n(chat panel)"]
        CM["ChatMessage\n(bubbles)"]
        RP["ReviewPrompt\n(star rating)"]
        UC["useChat hook\n(state + SSE streaming)"]
        LS["localStorage\ndk_chat_session_id"]

        CW --> CD
        CD --> CM
        CD --> RP
        CD --> UC
        UC --> LS
    end

    subgraph EdgeFunctions ["Supabase Edge Functions (Deno)"]
        CF["chat/index.ts\nMain orchestrator"]
        SR["submitReview/index.ts\nSave ratings"]
        CT["_shared/chatTools.ts\nTool registry"]
        CF --> CT
    end

    subgraph OpenAI ["OpenAI APIs"]
        EMB["Embeddings API\ntext-embedding-3-small"]
        GPT["Chat Completions API\ngpt-4o-mini + streaming"]
    end

    subgraph Supabase ["Supabase (Postgres + pgvector)"]
        KC["knowledge_chunks\n178 embedded doc chunks"]
        CS["chat_sessions\nper-user threads"]
        CH["chat_messages\nfull history"]
        RV["reviews\nstar ratings"]
        MS["match_knowledge_chunks()\nHNSW similarity search"]
    end

    subgraph Notion ["Notion (optional)"]
        NDB["Reviews database\nNOTION_DATABASE_ID"]
    end

    UC -->|"POST /functions/v1/chat\nBearer JWT + message"| CF
    UC -->|"POST /functions/v1/submitReview\nrating + comment"| SR

    CF -->|"embed query"| EMB
    CF -->|"rpc match_knowledge_chunks"| MS
    MS --> KC
    CF -->|"stream chat"| GPT
    CF -->|"read/write"| CS
    CF -->|"read/write"| CH
    CF -->|"SSE stream delta chunks"| UC

    SR -->|"insert"| RV
    SR -->|"optional sync"| NDB

    style Frontend fill:#e8f4f8,stroke:#0288d1,color:#000
    style EdgeFunctions fill:#f3e5f5,stroke:#7b1fa2,color:#000
    style OpenAI fill:#fff8e1,stroke:#f57f17,color:#000
    style Supabase fill:#e8f5e9,stroke:#2e7d32,color:#000
    style Notion fill:#fce4ec,stroke:#c62828,color:#000
```

---

## Request Flow (Per Message)

```mermaid
sequenceDiagram
    actor User
    participant FE as React Frontend<br/>(useChat hook)
    participant CF as chat Edge Function<br/>(Deno)
    participant Auth as Supabase Auth
    participant DB as Supabase Postgres
    participant EMB as OpenAI Embeddings<br/>text-embedding-3-small
    participant GPT as OpenAI Chat<br/>gpt-4o-mini

    User->>FE: Types a message, hits Send
    FE->>FE: Optimistically renders user bubble<br/>+ empty assistant bubble (streaming=true)
    FE->>CF: POST /functions/v1/chat<br/>{ session_id?, message }<br/>Authorization: Bearer <JWT>

    CF->>Auth: getUser(token)
    Auth-->>CF: user { id, email }

    Note over CF: Session handling
    alt session_id provided
        CF->>DB: SELECT chat_sessions WHERE id=session_id AND user_id=uid
        DB-->>CF: existing session
    else new conversation
        CF->>DB: INSERT chat_sessions { user_id }
        DB-->>CF: new session_id
    end

    CF->>DB: SELECT last 12 chat_messages for session
    DB-->>CF: conversation history

    CF->>EMB: POST /v1/embeddings<br/>{ model: text-embedding-3-small, input: message }
    EMB-->>CF: 1536-dim vector

    CF->>DB: rpc match_knowledge_chunks(<br/>  query_embedding,<br/>  match_threshold: 0.4,<br/>  match_count: 5<br/>)
    DB-->>CF: top-5 relevant doc chunks

    Note over CF: Build prompt:<br/>system = DK support role + injected chunks<br/>messages = history + user message

    CF->>DB: INSERT chat_messages { role: user, content }
    CF->>DB: COUNT chat_messages for session
    alt msgCount >= 6 AND review not yet requested
        CF->>DB: UPDATE chat_sessions SET review_requested=true
        Note over CF: Will send show_review_prompt=true in final SSE event
    end

    CF->>GPT: POST /v1/chat/completions<br/>{ model, messages, tools: [], stream: true }

    loop Stream chunks
        GPT-->>CF: SSE: data: { delta: "You can..." }
        CF-->>FE: SSE: data: { delta: "You can..." }
        FE->>FE: Append delta to assistant bubble
    end

    GPT-->>CF: SSE: data: [DONE]
    CF->>DB: INSERT chat_messages { role: assistant, content: fullContent }
    CF-->>FE: SSE: data: { done: true, session_id, show_review_prompt }

    FE->>FE: Mark streaming=false<br/>Save session_id to localStorage
    alt show_review_prompt = true
        FE->>FE: Render ReviewPrompt component inline
    end
```

---

## Knowledge Base Pipeline

```mermaid
flowchart TD
    A["App UI at\nlocalhost:5173"] -->|Playwright crawl| B["dk-crawl.cjs\nPlaywright script"]
    B -->|"navigates every route\ncaptures headings, buttons,\nform fields, page content"| C["44 Markdown files\nin dk+_backend/docs/"]

    C --> C1["pages/*.md\n(per-route docs)"]
    C --> C2["features/*.md\n(flow docs)"]
    C --> C3["faq.md\ngetting-started.md\nbilling.md"]

    C1 --> D["embed-docs.ts\nNode.js embed script"]
    C2 --> D
    C3 --> D

    D -->|"chunk at 1600 chars\n200-char overlap"| E["Text chunks\n~178 total"]
    E -->|"POST /v1/embeddings\ntext-embedding-3-small"| F["1536-dim vectors"]
    F -->|"DELETE old + INSERT new\nfor each source_file"| G[("knowledge_chunks\nSupabase pgvector\nHNSW index")]

    H["User asks a question"] -->|"same embedding model"| I["Query vector"]
    I -->|"match_knowledge_chunks()\ncosine similarity > 0.4\ntop 5 results"| G
    G -->|"relevant chunks"| J["Injected into\nsystem prompt"]

    style G fill:#e8f5e9,stroke:#2e7d32,color:#000
    style F fill:#fff8e1,stroke:#f57f17,color:#000
```

**Updating the knowledge base:**

```bash
# 1. Edit any .md file in dk+_backend/docs/
# 2. Re-run the embed script — changes are live immediately

cd dk+_backend/scripts
OPENAI_API_KEY=sk-... \
SUPABASE_URL=https://xnflihspegizweqidvow.supabase.co \
SUPABASE_SERVICE_KEY=eyJ... \
npm run embed
```

No redeployment needed. The Edge Function always queries live pgvector.

---

## Database Schema

```mermaid
erDiagram
    auth_users {
        uuid id PK
        text email
    }

    knowledge_chunks {
        uuid id PK
        text source_file
        text content
        vector_1536 embedding
        timestamptz created_at
    }

    chat_sessions {
        uuid id PK
        uuid user_id FK
        boolean review_requested
        timestamptz created_at
    }

    chat_messages {
        uuid id PK
        uuid session_id FK
        text role
        text content
        text tool_name
        jsonb tool_result
        timestamptz created_at
    }

    reviews {
        uuid id PK
        uuid user_id FK
        int rating
        text comment
        text page_url
        timestamptz created_at
    }

    auth_users ||--o{ chat_sessions : "has"
    chat_sessions ||--o{ chat_messages : "contains"
    auth_users ||--o{ reviews : "submits"
```

**Key design decisions:**

| Decision | Reason |
|---|---|
| `tool_name` + `tool_result` columns on `chat_messages` | Tier 2/3 tool call results stored without schema change |
| `review_requested` boolean on `chat_sessions` | Prevents double-prompting on same session |
| HNSW index on `embedding` | Sub-millisecond similarity search at scale |
| Cosine similarity threshold 0.4 | Low enough to catch related content, high enough to avoid noise |
| Last 12 messages in history | Balances context quality vs token cost |

**RLS Policies:**

| Table | Policy |
|---|---|
| `knowledge_chunks` | Authenticated users can SELECT (read-only, no client writes) |
| `chat_sessions` | Users can SELECT/UPDATE own rows only (`user_id = auth.uid()`) |
| `chat_messages` | Users can SELECT messages from sessions they own (subquery join) |
| `reviews` | Users can SELECT and INSERT own rows |
| All tables | Service role (Edge Functions) bypasses RLS entirely |

---

## Frontend Components

```mermaid
graph TD
    DL["DashboardLayout.tsx\n(every authenticated page)"]
    DL --> CW

    subgraph ChatSystem ["Chat System — src/components/chat/"]
        CW["ChatWidget.tsx\nfloating button, z-index 800\ntoggles open/close"]
        CD["ChatDrawer.tsx\nfixed panel 320×500px\nheader + scrollable messages + input"]
        CM["ChatMessage.tsx\nbubble per turn\nstreaming cursor animation"]
        RP["ReviewPrompt.tsx\n1–5 stars + textarea\nPOST to submitReview"]
    end

    subgraph Hook ["src/hooks/useChat.ts"]
        UC["useChat()\nall state + SSE logic"]
        UC --> S1["messages: ChatMessage[]"]
        UC --> S2["isStreaming: boolean"]
        UC --> S3["showReviewPrompt: boolean"]
        UC --> S4["error: string | null"]
        UC --> S5["sessionIdRef → localStorage\ndk_chat_session_id"]
    end

    CW --> CD
    CD --> CM
    CD --> RP
    CD --> UC

    UC -->|"SSE fetch"| EF["chat Edge Function"]
    RP -->|"POST fetch"| SR["submitReview Edge Function"]

    style ChatSystem fill:#e8f4f8,stroke:#0288d1,color:#000
    style Hook fill:#f3e5f5,stroke:#7b1fa2,color:#000
```

**Session persistence:** `sessionIdRef` holds the UUID in memory and is backed by `localStorage['dk_chat_session_id']`. On reload, the existing session ID is sent to the Edge Function, which loads history from `chat_messages`. If the session is deleted or expired, a new one is created.

---

## Review Flow

```mermaid
flowchart TD
    A["User sends message"] --> B["chat Edge Function\ncounts messages in session"]
    B --> C{msgCount >= 6\nAND review_requested = false?}
    C -->|No| D["Normal SSE stream\nshow_review_prompt: false"]
    C -->|Yes| E["UPDATE chat_sessions\nSET review_requested = true"]
    E --> F["SSE final event:\nshow_review_prompt: true"]
    F --> G["Frontend renders\nReviewPrompt inline in chat"]
    G --> H["User picks 1–5 stars\n+ optional comment"]
    H --> I["POST /functions/v1/submitReview\n{ rating, comment, page_url }"]
    I --> J["INSERT into reviews table\n(Supabase Postgres)"]
    J --> K{NOTION_TOKEN\nset?}
    K -->|Yes| L["POST to Notion API\nAppend row to reviews DB"]
    K -->|No| M["Skip — non-fatal"]
    L --> N["Thank you message\nshown in chat"]
    M --> N

    style J fill:#e8f5e9,stroke:#2e7d32,color:#000
    style L fill:#fce4ec,stroke:#c62828,color:#000
```

---

## Tier 2 / Tier 3 Upgrade Path

### Activating Tier 2 (Navigation + Confirmation)

**Step 1** — Flip one line in [`supabase/functions/_shared/chatTools.ts`](../supabase/functions/_shared/chatTools.ts):

```typescript
// Before (Tier 1):
export const ACTIVE_TOOLS = TIER_1_TOOLS;

// After (Tier 2):
export const ACTIVE_TOOLS = TIER_2_TOOLS;
```

**Step 2** — Add a tool execution handler in `chat/index.ts` inside an agent loop:

```typescript
// Agent loop — runs until GPT stops calling tools
while (true) {
  const response = await callOpenAI(messages, ACTIVE_TOOLS);

  if (response.finish_reason === "tool_calls") {
    for (const toolCall of response.tool_calls) {
      let result;

      switch (toolCall.function.name) {
        case "navigate_to_page":
          // Stream a special SSE event the frontend intercepts to navigate
          result = { navigated: true, path: toolCall.function.arguments.path };
          break;

        case "request_confirmation":
          // Pause and ask user to confirm — frontend shows [Confirm] / [Cancel]
          result = { awaiting_confirmation: true };
          break;
      }

      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }
    continue; // loop back — GPT sees tool results and responds
  }

  // No tool calls — stream text back to user and break
  streamToClient(response.content);
  break;
}
```

**Step 3** — `supabase functions deploy chat`

```mermaid
flowchart LR
    A["User: 'take me to campaigns'"] --> B["GPT sees TIER_2_TOOLS\nin the prompt"]
    B --> C["finish_reason: tool_calls\nnavigate_to_page: /campaigns/create"]
    C --> D["Edge Function intercepts\nexecutes tool logic"]
    D --> E["Tool result fed back to GPT"]
    E --> F["GPT generates\nconfirmation text"]
    F --> G["Streamed to user\n'Taking you to Create Campaign...'"]
    G --> H["Frontend receives\nnavigation SSE event"]
    H --> I["react-router navigate()"]

    style C fill:#fff3cd,stroke:#ffc107,color:#000
    style D fill:#f3e5f5,stroke:#7b1fa2,color:#000
```

### Tier 3 — Agentic Workflows

Same loop, longer chains. Example: "Create a campaign targeting downtown Austin":

```mermaid
sequenceDiagram
    participant U as User
    participant GPT as GPT-4o-mini
    participant EF as Edge Function
    participant DB as Supabase

    U->>GPT: "Create a campaign targeting downtown Austin"
    GPT->>EF: tool_call: get_zones()
    EF->>DB: SELECT targeting_zones
    DB-->>EF: [] (no zones yet)
    EF-->>GPT: { zones: [] }
    GPT->>EF: tool_call: request_confirmation("Create zone: downtown Austin, 0.5mi radius")
    EF-->>U: "I'll create a targeting zone for downtown Austin — confirm?"
    U->>EF: "Yes, go ahead"
    GPT->>EF: tool_call: create_zone({ address: "downtown Austin", radius: 0.5 })
    EF->>DB: INSERT targeting_zones
    DB-->>EF: { zone_id: "abc123" }
    GPT->>EF: tool_call: create_campaign({ name: "Austin Downtown", zone_id: "abc123" })
    EF->>DB: INSERT campaigns
    DB-->>EF: { campaign_id: "xyz789" }
    GPT-->>U: "Done! Campaign 'Austin Downtown' created with 347 addresses."
```

---

## Cost Estimate

| Usage level | Messages/day | Monthly OpenAI cost |
|---|---|---|
| Low (pilot) | 50 | ~$0.50 |
| Medium (active) | 500 | ~$5.00 |
| High (scale) | 5,000 | ~$50.00 |

*Based on avg ~1,500 input tokens + ~300 output tokens per message at gpt-4o-mini rates.*

Embeddings: one-time cost of ~$0.0001 to embed all 178 chunks. Re-embedding on doc updates costs the same.

---

## Secrets & Config

| Secret | Where set | Used by |
|---|---|---|
| `OPENAI_API_KEY` | `supabase secrets set OPENAI_API_KEY=sk-...` | `chat` function (embed + chat) |
| `NOTION_TOKEN` | `supabase secrets set NOTION_TOKEN=secret_...` | `submitReview` (optional) |
| `NOTION_DATABASE_ID` | `supabase secrets set NOTION_DATABASE_ID=abc123` | `submitReview` (optional) |
| `VITE_SUPABASE_URL` | Frontend `.env` | `useChat` hook |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env` | All Supabase client calls |

**Deploying updates:**

```bash
# Redeploy chat function after any backend change
cd dk+_backend
supabase functions deploy chat
supabase functions deploy submitReview

# Rebuild knowledge base after editing docs
cd dk+_backend/scripts
OPENAI_API_KEY=sk-... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npm run embed
```
