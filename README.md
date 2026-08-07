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
  pick_up_by text,
  last_name text,
  action text,
  service_type text,
  addons text[] default '{}',
  package_id uuid,
  signature_data text,
  price numeric,
  bath_size text,
  created_at timestamptz default now()
);
alter table signins enable row level security;
create policy "allow all" on signins for all using (true) with check (true);

create table packages (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  dog_name text,
  phone text,
  total_days integer not null,
  days_used integer not null default 0,
  created_at timestamptz default now()
);
alter table packages enable row level security;
create policy "allow all" on packages for all using (true) with check (true);
```

If you already have a `packages` table from an earlier version, just add the new column:

```sql
alter table packages add column if not exists dog_name text;
```

If you already created the `signins` table from an earlier version, just run this to add the new columns instead of recreating it:

```sql
alter table signins add column if not exists addons text[] default '{}';
alter table signins add column if not exists package_id uuid;
alter table signins add column if not exists client_id uuid;
alter table signins add column if not exists pick_up_by text;
alter table signins add column if not exists price numeric;
alter table signins add column if not exists bath_size text;
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

1. First-time visitors go to `/signup` (there's a link on the kiosk screen) and fill in the dog's name, last name, usual drop-off person, phone number, and sign the waiver once. **Multiple dogs** on the same account can be added right there in one sitting — an "+ Add another dog" button adds another name/last-name pair, and one signature at the end covers all of them, saved as separate records under the same phone number.
2. From then on, the kiosk home screen only asks for a phone number. Typing one in looks up every dog on file for that number and shows them for confirmation — no re-typing name/last name and no re-signing, since the waiver's already on file.
3. **Multiple dogs, same phone number:** if a phone number matches more than one dog, the kiosk shows a picker where you tap every dog checking in together — both can be signed in (or out) in the same action, one tap on "Sign in" creates a separate record for each selected dog. Nothing auto-selects when there's more than one, so adding a second dog never hides the first.
4. **Already-signed-in indicator:** the kiosk checks today's records for each matched dog — a dog currently dropped off (no pick-up logged yet) shows a "🟢 Signed in" badge in the picker and on their card. If Drop off is selected for a dog that's already signed in, a warning nudges toward Pick up instead — it doesn't hard-block (staff can still correct a mistake), but it catches the common accidental double-drop-off before it happens.
4. Staff/owner still pick drop-off vs. pick-up, service type, and add-ons once per visit — shared across whichever dogs are selected, since those usually match for dogs going in together.
5. If a phone number doesn't match any signup, the kiosk shows a prompt pointing to `/signup` instead of letting the visit be logged — this keeps every dog on file with a signed waiver.
6. Each saved sign-in links back to the specific dog's client record via `client_id`, so records can always be traced to the signup that authorized them.

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

1. On `/packages`, add a client's package: name, phone number, days it covers, and now an **optional dog name**. Leave the dog name blank for a package shared across every dog on that phone number; set it to tie a package to one specific dog when a family's dogs don't share the same package.
2. On the kiosk, when someone types a phone number that matches, each selected dog shows its own package badge — a dog-specific package takes priority; a phone-only (no dog name) package is used as the shared fallback.
3. If the visit is a **daycare drop-off** and a package is found for that dog, one day is deducted automatically on submit. Pick-ups just display the remaining count, they don't deduct. With multiple dogs selected, each dog's own package (if any) is checked and deducted independently.
4. Phone numbers are auto-formatted as `(555) 123-4567` everywhere — the kiosk and the packages page both format as-you-type, so matching is reliable without staff needing to type it a specific way.
5. `/packages` lets you edit a package's total day count anytime (Edit button), or manually nudge the used-days count up/down for corrections.

## Service locking and walk-in pricing

- **A dog can only be picked up under the service it was dropped off as** — daycare in means daycare out, boarding in means boarding out. The kiosk locks this automatically: at pick-up, each selected dog's service is read from their most recent open drop-off (see the lookup in `components/KioskForm.tsx` and the pricing math in `lib/pricing.ts`), shown as a badge, and the manual Service selector only reappears as a fallback for a dog with no open drop-off on file (a correction scenario). This lookup isn't limited to "today" — a boarding stay's drop-off can be several days before its pick-up.
- **A package only ever covers a FULL daycare day — never a half day, add-ons, or boarding.** Since a package day can only be decided once the actual visit length is known, package deduction happens at **pick-up**, not drop-off: if the visit turns out to be 4 hours or less, it's billed as a walk-in half day ($50) and no package day is used, even if one's on file. Walk/nail-trim/bath charges apply on top regardless of whether a package covers the base rate. Boarding never uses packages at all, so it always gets its full nightly + late-fee math.
- **A dog that's already signed in can't be dropped off again** — this is a hard block: the kiosk checks every selected dog against who's currently signed in before submitting, and refuses with a clear message (listing which dog(s)) until they're picked up first. The Sign In button itself disables and relabels to "Already signed in" the moment a duplicate is selected.
- **Pricing, defined in `lib/pricing.ts`:**
  - Daycare: **$70 full day**, or **$50 half day** if 4 hours or less between drop-off and pick-up.
  - Boarding: **$90/night** (partial nights round up to a full night), **+$50** if picked up at or after 12:00 PM (an extra half-day daycare fee for the late checkout).
  - **Walk (+$30) and nail trim (+$25)** are added automatically the moment those add-ons are picked at drop-off.
  - **Bath is priced separately**, by size — S ($60) / M ($80) / L ($100) — assigned on `/records`, not at the kiosk, since bath has no one fixed price. Once a size is set, it's included everywhere: the kiosk's pick-up screen picks it up automatically (bath size can be assigned any time, even mid-visit, and doesn't require staff to be on the records page at the moment of pick-up), and it shows in the price breakdown on both the kiosk and `/records`.
  - Meet & greet has no defined price.
- **A 🧾 icon next to any price** (kiosk pick-up screen and `/records`) toggles a line-by-line breakdown — base rate, each add-on, bath if set — instead of just the total.
- **`/records` shows a live estimate before pick-up too**, not just after. A dog still signed in shows its running total (marked "(est.)") using the current time as a stand-in pick-up, recalculated on load — so staff can see roughly what's owed without waiting for the dog to actually leave. Once picked up, the number becomes final (and freely editable for adjustments); the printed report never shows this column either way.
- **Deleting an entry fully clears "signed in" status** — the kiosk's signed-in/locked-service lookup always reads live from the `signins` table with no caching, so once every row for a dog's visit is deleted (or once a normal pick-up is logged), that phone number stops showing the dog as signed in on the very next kiosk lookup.

## Records and daily PDF

- `/records` shows one row per dog per day, with separate drop-off and pick-up time columns — unchanged from before. The only related update: since packages can now be tied to a specific dog, the package column matches a dog-specific package first and falls back to a shared one, instead of just picking the newest package for that phone number regardless of which dog it was for.
- **Grouped by service**: rows are sorted into Daycare, then Boarding, then Meet & greet sections (each with a small header row), instead of one flat list sorted purely by time. This applies on-screen and on the printed report.
- Each row has **Edit** (last name, drop-off-by, picked-up-by, service, add-ons, and the actual drop-off/pick-up times) and **Delete**. Delete removes every underlying record for that dog/day — including any duplicate sign-ins from before the kiosk's "already signed in" warning existed, not just the most recent drop-off/pick-up pair.
- Pick a date with the date picker (defaults to today), then **Print / Save as PDF** opens your browser's print dialog — unchanged. Choose "Save as PDF" as the destination to get a PDF formatted like the on-screen list.

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
