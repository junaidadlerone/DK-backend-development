-- DK+ assistant reliability batch (2026-08-03). Two additive columns; no data is rewritten and no
-- existing behaviour depends on either, so this is safe to apply ahead of the gateway deploy.
--
-- 1. chat_surfaces.state — THE SURFACE LIFECYCLE (D4).
--    Reported bug: completed cards became actionable again. Two independent chains caused it, and
--    only one was fixable in the browser:
--      * the live lock was `disabled={isStreaming}`, which re-arms the moment the stream ends, and
--        the per-card `done` flag lived in React state that dies on unmount — and the widget
--        unmounts both on panel minimize and on route navigation;
--      * `persistTurn` upsert every surface with `interaction: null`, so a re-emit ERASED a
--        recorded Approve.
--    A surface therefore needs a terminal state that outlives the component and the stream, on the
--    server, where it can be re-derived after any unmount:
--      open      — actionable
--      consumed  — terminal: the user acted on it, or a newer copy replaced it
--    `interaction` already records WHAT the user did; `state` records THAT it is finished, which is
--    the part the client could not remember. The gateway refuses to stream a frame for a consumed
--    surface, so a re-emit cannot resurrect one.
--
-- 2. chat_messages.turn_id — THE OBSERVABILITY SUBSTRATE (D5).
--    Every reported defect had to be reproduced by a person in a browser because a turn left no
--    correlatable record: the gateway's logs, the LangSmith trace and the persisted row shared only
--    a session id, and a session is many turns. One id per turn, stamped on the assistant row and
--    attached to the trace metadata, makes "show me everything about that turn" answerable.
--    Nullable and unconstrained on purpose — historic rows have no turn, and a turn that fails
--    before it persists still logs its id.

alter table public.chat_surfaces
  add column if not exists state text not null default 'open';

-- Added separately from the column so re-running the migration cannot fail on a duplicate
-- constraint (add column ... if not exists does not extend to inline constraints).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_surfaces_state_check'
      and conrelid = 'public.chat_surfaces'::regclass
  ) then
    alter table public.chat_surfaces
      add constraint chat_surfaces_state_check check (state in ('open', 'consumed'));
  end if;
end $$;

comment on column public.chat_surfaces.state is
  'open = actionable; consumed = terminal (user acted, or a newer copy replaced it). Survives widget unmount and route navigation, which per-card React state did not.';

-- Backfill: any surface the user already acted on is terminal. Surfaces with no interaction stay
-- 'open' — an old actionable card is exactly what it was before this column existed.
update public.chat_surfaces
  set state = 'consumed'
  where interaction is not null and state <> 'consumed';

-- The gateway checks state per surface_id when deciding whether a frame may stream, and the
-- frontend hydrates locks from it on reload.
create index if not exists chat_surfaces_state_idx
  on public.chat_surfaces (session_id, state);

alter table public.chat_messages
  add column if not exists turn_id uuid;

comment on column public.chat_messages.turn_id is
  'Correlates this row with the gateway log lines and the LangSmith/Langfuse trace for the same turn. Null for historic rows.';

create index if not exists chat_messages_turn_idx
  on public.chat_messages (turn_id);
