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
--   read  site_photos     (the website images)
--   write enrollments     (somebody submitting the enrollment form)
--   write boarding_requests (somebody requesting dates)
--
-- Everything else requires a signed-in session. That includes the lobby
-- kiosk, which is why it now asks to be set up once per device.
--
-- RUN THIS ONLY AFTER creating the accounts and deploying the code that
-- signs in — the moment it runs, an unauthenticated app stops working.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

-- ---------------------------------------------------------------------
-- 1. Remove the blanket policies.
-- ---------------------------------------------------------------------
drop policy if exists "allow all" on dogs;
drop policy if exists "allow all" on owners;
drop policy if exists "allow all" on signins;
drop policy if exists "allow all" on boardings;
drop policy if exists "allow all" on packages;
drop policy if exists "allow all" on package_uses;
drop policy if exists "allow all" on payments;
drop policy if exists "allow all" on vaccinations;
drop policy if exists "allow all" on meal_logs;
drop policy if exists "allow all" on walk_logs;
drop policy if exists "allow all" on dog_docs;
drop policy if exists "allow all" on enrollments;
drop policy if exists "allow all" on boarding_requests;
drop policy if exists "allow all" on settings;
drop policy if exists "allow all" on site_photos;

-- ---------------------------------------------------------------------
-- 2. Signed-in users get full access. Staff and the kiosk are both real
--    accounts, so one rule covers them.
-- ---------------------------------------------------------------------
create policy "staff full access" on dogs              for all to authenticated using (true) with check (true);
create policy "staff full access" on owners            for all to authenticated using (true) with check (true);
create policy "staff full access" on signins           for all to authenticated using (true) with check (true);
create policy "staff full access" on boardings         for all to authenticated using (true) with check (true);
create policy "staff full access" on packages          for all to authenticated using (true) with check (true);
create policy "staff full access" on package_uses      for all to authenticated using (true) with check (true);
create policy "staff full access" on payments          for all to authenticated using (true) with check (true);
create policy "staff full access" on vaccinations      for all to authenticated using (true) with check (true);
create policy "staff full access" on meal_logs         for all to authenticated using (true) with check (true);
create policy "staff full access" on walk_logs         for all to authenticated using (true) with check (true);
create policy "staff full access" on dog_docs          for all to authenticated using (true) with check (true);
create policy "staff full access" on enrollments       for all to authenticated using (true) with check (true);
create policy "staff full access" on boarding_requests for all to authenticated using (true) with check (true);
create policy "staff full access" on settings          for all to authenticated using (true) with check (true);
create policy "staff full access" on site_photos       for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 3. The four things the public pages need, and nothing more.
--
--    Note these are INSERT-only for the two request tables: a visitor can
--    submit a form but cannot read back what anyone else submitted, which
--    would otherwise expose every applicant name, phone and address.
-- ---------------------------------------------------------------------
create policy "public read" on settings    for select to anon using (true);
create policy "public read" on site_photos for select to anon using (true);

create policy "public submit" on enrollments       for insert to anon with check (true);
create policy "public submit" on boarding_requests for insert to anon with check (true);

-- ---------------------------------------------------------------------
-- 4. Check. Expect: no rows anywhere with the old blanket policy, and anon
--    holding only the four grants above.
-- ---------------------------------------------------------------------
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
