-- Row Level Security lockdown.
--
-- Until now every table carried a blanket allow-all policy that permitted
-- anything to anyone holding the anon key. That key ships inside the
-- JavaScript of the public website, so in practice every dog, owner,
-- payment and phone number was readable by anyone who opened dev tools.
-- The staff passcode did not help: it was a check in the browser, and the
-- database was never asked.
--
-- After this, the anon key can do exactly four things, all of which the
-- public pages genuinely need:
--
--   read  settings        (prices and branding, shown on the website)
--   read  site_photos     (the website images, when that table exists)
--   write enrollments     (somebody submitting the enrollment form)
--   write boarding_requests (somebody requesting dates)
--
-- Everything else requires a signed-in session. That includes the lobby
-- kiosk, which is why it now asks to be set up once per device.
--
-- RUN THIS ONLY AFTER creating the accounts and deploying the code that
-- signs in — the moment it runs, an unauthenticated app stops working.
--
-- Tables that do not exist are skipped rather than fatal.
--
-- The first version named every table directly, so a database that had not
-- run one of the optional migrations failed on the first missing name and
-- rolled the whole thing back — leaving the database wide open while
-- appearing to have been secured. Optional tables really are optional:
-- site_photos and reviews only exist once their migrations are run.
--
-- Safe to run more than once.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

do $lockdown$
declare
  -- Everything the app owns. Missing ones are skipped.
  all_tables text[] := array[
    'dogs', 'owners', 'signins', 'boardings', 'packages', 'package_uses',
    'payments', 'vaccinations', 'meal_logs', 'walk_logs', 'dog_docs',
    'enrollments', 'boarding_requests', 'settings', 'site_photos', 'reviews'
  ];
  -- Readable by the public website without signing in.
  public_read text[] := array['settings', 'site_photos', 'reviews'];
  -- Writable by the public: form submissions, insert only.
  public_insert text[] := array['enrollments', 'boarding_requests'];
  t text;
  skipped text[] := '{}';
begin
  foreach t in array all_tables loop
    if to_regclass('public.' || t) is null then
      skipped := skipped || t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- 1. Remove the blanket policy and anything this script wrote before.
    execute format('drop policy if exists "allow all" on public.%I', t);
    execute format('drop policy if exists "staff full access" on public.%I', t);
    execute format('drop policy if exists "public read" on public.%I', t);
    execute format('drop policy if exists "public submit" on public.%I', t);

    -- 2. Any signed-in account gets full access. Staff and the kiosk are
    --    both real accounts, so one rule covers them.
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated using (true) with check (true)',
      t
    );

    -- 3. The narrow public grants.
    if t = any(public_read) then
      execute format('create policy "public read" on public.%I for select to anon using (true)', t);
    end if;

    if t = any(public_insert) then
      -- Insert only: a visitor can submit a form but cannot read back what
      -- anyone else submitted, which would expose every applicant name,
      -- phone and address.
      execute format('create policy "public submit" on public.%I for insert to anon with check (true)', t);
    end if;
  end loop;

  if array_length(skipped, 1) is not null then
    raise notice 'Skipped tables that do not exist: %', array_to_string(skipped, ', ');
  end if;
end
$lockdown$;

-- ---------------------------------------------------------------------
-- Check. Expect every table to show staff full access for authenticated,
-- and anon to appear only on settings/site_photos/reviews (select) and
-- enrollments/boarding_requests (insert).
-- ---------------------------------------------------------------------
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
