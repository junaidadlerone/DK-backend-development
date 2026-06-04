-- Schedule daily cleanup of organizations whose deletion recovery window has
-- elapsed. The pg_cron job triggers the `sendOrganizationDeletedEmail` edge
-- function via pg_net; that function emails each owner and then permanently
-- deletes the organization.
--
-- PREREQUISITES (must exist before this migration runs in an environment):
--   1. The `sendOrganizationDeletedEmail` edge function is deployed.
--   2. Two secrets exist in Supabase Vault:
--        - 'project_url'        e.g. https://<project-ref>.supabase.co
--        - 'service_role_key'   the project's service-role key
--      Create them once per environment, e.g.:
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--        select vault.create_secret('<service-role-key>', 'service_role_key');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Wrapper that resolves the function URL + auth from Vault and fires the request.
create or replace function public.trigger_organization_deletion_cleanup()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_project_url text;
  v_service_role_key text;
begin
  select decrypted_secret into v_project_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  select decrypted_secret into v_service_role_key
  from vault.decrypted_secrets
  where name = 'service_role_key'
  limit 1;

  if v_project_url is null or v_service_role_key is null then
    raise warning 'trigger_organization_deletion_cleanup: missing project_url or service_role_key in vault; skipping';
    return;
  end if;

  perform net.http_post(
    url     => v_project_url || '/functions/v1/sendOrganizationDeletedEmail',
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role_key
    ),
    body    => '{}'::jsonb
  );
end;
$$;

-- (Re)schedule the job idempotently: drop any prior definition, then create.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'organization-deletion-cleanup') then
    perform cron.unschedule('organization-deletion-cleanup');
  end if;
end;
$$;

-- Daily at 12:00 AM (server time).
select cron.schedule(
  'organization-deletion-cleanup',
  '0 0 * * *',
  $$ select public.trigger_organization_deletion_cleanup(); $$
);
