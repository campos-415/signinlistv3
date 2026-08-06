# Dog daycare sign-in kiosk

Lobby sign-in/out form for a dog daycare front desk. Next.js 14 + TypeScript + Supabase, meant to run on an iPad/tablet in the lobby.

## 1. Supabase setup

Create a free project at supabase.com, then run this in the SQL editor:

```sql
create table signins (
  id uuid primary key default gen_random_uuid(),
  dog_name text,
  phone text,
  drop_off_by text,
  last_name text,
  action text,
  service_type text,
  addons text[] default '{}',
  package_id uuid,
  signature_data text,
  created_at timestamptz default now()
);
alter table signins enable row level security;
create policy "allow all" on signins for all using (true) with check (true);

create table packages (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  phone text,
  total_days integer not null,
  days_used integer not null default 0,
  created_at timestamptz default now()
);
alter table packages enable row level security;
create policy "allow all" on packages for all using (true) with check (true);
```

If you already created the `signins` table from an earlier version, just run this to add the new columns instead of recreating it:

```sql
alter table signins add column if not exists addons text[] default '{}';
alter table signins add column if not exists package_id uuid;
alter table signins add column if not exists client_id uuid;
```

Then add the `clients` table — this is the one-time signup/waiver profile, looked up by phone at check-in:

```sql
create table clients (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  dog_name text not null,
  last_name text not null,
  drop_off_by text,
  signature_data text,
  created_at timestamptz default now()
);
alter table clients enable row level security;
create policy "allow all" on clients for all using (true) with check (true);
```

Grab your **Project URL** and **anon public key** from Settings → API.

`allow all` means anyone with the anon key can read/write this table — fine for a lobby kiosk with low-stakes data, but worth knowing. If you want it locked down properly later, that's a good use for Supabase Auth or a server-side API route instead of writing straight from the browser.

## 2. Local setup

```bash
npm install
cp .env.local.example .env.local
```

Fill in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase.
- `NEXT_PUBLIC_RECORDS_PASSCODE` — any word or number, this gates the `/records` staff page. Not real security (it's a client-side check), just keeps casual visitors out.

```bash
npm run dev
```

Open http://localhost:3000 for the kiosk form, http://localhost:3000/signup for the one-time client signup/waiver, http://localhost:3000/records for saved sign-ins, and http://localhost:3000/packages to add or review client daycare packages (same passcode as records).

## How pre-registration works

1. First-time visitors go to `/signup` (there's a link on the kiosk screen) and fill in the dog's name, last name, usual drop-off person, phone number, and sign the waiver once.
2. From then on, the kiosk home screen only asks for a phone number. Typing one in looks the client up automatically and shows their dog's name for confirmation — no re-typing name/last name and no re-signing, since the waiver's already on file.
3. Staff/owner still pick drop-off vs. pick-up, service type, and add-ons each visit, since those change day to day.
4. If a phone number doesn't match any signup, the kiosk shows a prompt pointing to `/signup` instead of letting the visit be logged — this keeps every dog on file with a signed waiver.
5. Each saved sign-in links back to the client via `client_id`, so records can always be traced to the signup that authorized them.

## PetExec sync (one lookup left)

Every kiosk sign-in fires a call to `app/api/petexec-checkin/route.ts`, which pushes it to PetExec.

**Confirmed and built:**
- OAuth2 token exchange (`lib/petexec.ts`) — `POST /token` with Basic auth, cached in memory.
- `schedulePetExecDaycare()` — `POST /daycare`, creates a same-day daycare appointment. Used on kiosk drop-off.
- `markPetExecPickup()` — `PUT /daycare/:daycareid`, sets pick-up time on an existing appointment.
- `getPetExecDaycareServices()` — `GET /daycare/services`, PetExec's service ID catalog.

**Still blocking everything above:** `getPetIdForPhone()` in `lib/petexec.ts` is a stub. Every Daycare call needs PetExec's internal `petid`, and the lookup-by-phone endpoint hasn't been found in the docs yet — it's almost certainly under an "Owner" or "Pet" section in the same API docs sidebar (tied to the `owner_read`/`pet_read` scopes already granted). Screenshot that section (should include something like "Get an owner" or "Get owner's pets" by phone/email/name) and this can be filled in.

**Also needed before pick-up sync works:** finding today's PetExec `daycareid` for a given pet — likely via the "Get all current signed-in daycares" list, filtered to match. Not wired up yet.

**Setup once the lookup is confirmed:**
1. Register a real API Application on your actual Lombard PetExec account with scopes `owner_read`, `pet_read`, `daycare_create`, `daycare_update`, `daycare_read`. Save the Client ID/Secret immediately.
2. Add `PETEXEC_CLIENT_ID`, `PETEXEC_CLIENT_SECRET`, `PETEXEC_USERNAME`, `PETEXEC_PASSWORD` to `.env.local` and Vercel.
3. Run `GET /daycare/services` (or check with your boss) to find which PetExec service ID represents a standard kiosk drop-off, and set `PETEXEC_DAYCARE_SERVICE_ID` to that number — the kiosk's own service/add-on picker doesn't map cleanly onto PetExec's more granular service catalog, so this is a simplification: every kiosk drop-off logs as one representative PetExec service for now.
4. Fill in `getPetIdForPhone()`.

Until then, the route no-ops and returns `{ skipped: true }` — the kiosk's own Supabase sign-in works exactly as before regardless.

## How packages work

1. On `/packages`, add a client's package: name, phone number, and how many days it covers.
2. On the kiosk, when someone types a phone number that matches a package, a badge appears showing days remaining — no extra steps needed, and it shows for both drop-off and pick-up.
3. If the visit is a **daycare drop-off** and a package is found, one day is deducted automatically on submit. Pick-ups just display the remaining count, they don't deduct.
4. Phone numbers are auto-formatted as `(555) 123-4567` everywhere — the kiosk and the packages page both format as-you-type, so matching is reliable without staff needing to type it a specific way.
5. `/packages` lets you edit a package's total day count anytime (Edit button), or manually nudge the used-days count up/down for corrections.

## Records and daily PDF

- `/records` shows one row per dog per day, with separate drop-off and pick-up time columns — no more duplicate rows for the same visit.
- Pick a date with the date picker (defaults to today), then **Print / Save as PDF** opens your browser's print dialog. Choose "Save as PDF" as the destination to get a PDF formatted like the on-screen list.

## 3. Deploy to Vercel

Push to GitHub, import into Vercel, add the three env vars above under Environment Variables, deploy.

## 4. Set up the lobby iPad

Open the Vercel URL in Safari → Share → **Add to Home Screen**. Then:
- Settings → **Guided Access** (Accessibility) lets you lock the iPad into just this app, so customers can't back out to the home screen or other apps. Turn it on, then triple-click the side button to start/stop the lock.
- Consider **Screen → Auto-Lock → Never** on the kiosk device (Settings → Display & Brightness) so it doesn't sleep between customers.

## Customizing

- Styled with Tailwind CSS. Colors live in `tailwind.config.ts` under the `accent` palette — change those hex values to rebrand everything at once, or edit classes directly in `components/KioskForm.tsx` and `app/records/page.tsx`.
- Business name: `app/layout.tsx` (title) and `components/KioskForm.tsx` (heading).
- Swap the 🐾 emoji for a real logo: replace it in `KioskForm.tsx` with an `<img src="/logo.png" className="h-16 w-16 rounded-2xl object-cover" />` and drop your logo file in `/public`.
- Icons in `/public` are placeholders — swap `icon-192.png` / `icon-512.png` for real art, same file names.

## Notes

- Signatures are stored as base64 PNG images directly in the database row. Fine at this volume; if the daycare gets very high traffic, moving signatures to Supabase Storage instead of the table is the next optimization.
- `/records` isn't linked from the kiosk page — bookmark it separately on a staff device.
# signinlistv3
# signinlistv3
