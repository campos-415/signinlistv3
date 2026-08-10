-- Gallery photos for the public website, uploaded from /settings.
-- Paste into the Supabase SQL editor and run once. Idempotent.
--
-- Their own table rather than a field on the settings row: settings are
-- loaded by every page in the app, including the lobby kiosk, and a dozen
-- base64 photos in there would be fetched constantly by screens that never
-- show them. The gallery page is the only thing that reads this.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

create table if not exists site_photos (
  id uuid primary key default gen_random_uuid(),
  -- Room for other placements later: hero, about, and so on.
  kind text not null default 'gallery',
  -- Alt text. Not optional in spirit: it is what a screen reader announces
  -- and what search engines index the image by.
  alt text,
  data text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

alter table site_photos enable row level security;

drop policy if exists "allow all" on site_photos;

create policy "allow all" on site_photos for all using (true) with check (true);

create index if not exists site_photos_kind_idx on site_photos (kind, sort_order);

-- Kind-specific fields. The team cards carry a name, role and bio
-- alongside the portrait; hero images need none of it. A JSON column keeps
-- one table serving every placement instead of one table per placement.
alter table site_photos add column if not exists meta jsonb default '{}'::jsonb;
