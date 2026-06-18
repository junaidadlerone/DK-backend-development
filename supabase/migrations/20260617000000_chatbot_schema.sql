-- Enable pgvector extension for semantic search
create extension if not exists vector;

-- Knowledge base chunks: stores chunked app documentation with embeddings
create table if not exists knowledge_chunks (
  id          uuid primary key default gen_random_uuid(),
  source_file text not null,            -- e.g. "faq.md" or "features/campaigns.md"
  content     text not null,
  embedding   vector(1536),             -- OpenAI text-embedding-3-small dimension
  created_at  timestamptz default now()
);

-- HNSW index for fast cosine similarity search
create index if not exists knowledge_chunks_embedding_idx
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- Chat sessions: one per conversation thread per user
create table if not exists chat_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade,
  created_at       timestamptz default now(),
  review_requested boolean default false
);

-- Chat messages: individual turns in a session
create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references chat_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'tool')),
  content     text not null,
  tool_name   text,     -- Tier 2/3: name of tool that was called
  tool_result jsonb,    -- Tier 2/3: result returned by the tool
  created_at  timestamptz default now()
);

create index if not exists chat_messages_session_idx on chat_messages (session_id, created_at);

-- Reviews: in-app star ratings submitted by users
create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  rating     int not null check (rating between 1 and 5),
  comment    text,
  page_url   text,
  created_at timestamptz default now()
);

-- Similarity search function used by the chat Edge Function
create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.4,
  match_count     int   default 5
)
returns table (id uuid, content text, source_file text, similarity float)
language sql stable as $$
  select
    id,
    content,
    source_file,
    1 - (embedding <=> query_embedding) as similarity
  from knowledge_chunks
  where 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
