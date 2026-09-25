-- Schedules the holded-daily-sync Edge Function to run once a day. The
-- Authorization header uses the project's anon (publishable) key, which is
-- not secret -- it's the same key already shipped in assets/config.js. The
-- function itself uses its own SUPABASE_SERVICE_ROLE_KEY (auto-injected,
-- never exposed here) to actually read Vault and write to the tables; the
-- anon key here only satisfies the Edge Function gateway's verify_jwt check.

select cron.schedule(
  'holded-daily-sync',
  '17 5 * * *',
  $$
  select net.http_post(
    url := 'https://pnprzupnqpjqgtlqkrfd.supabase.co/functions/v1/holded-daily-sync',
    headers := '{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBucHJ6dXBucXBqcWd0bHFrcmZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MTIyMjYsImV4cCI6MjEwMzQ4ODIyNn0.o6rdGhE3AZEdAnJEVSnpaN5TRf3Gp0x3IglvxjP01go", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
