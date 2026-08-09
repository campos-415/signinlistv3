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
alter table signins add column if not exists walk_out text;
alter table signins add column if not exists walk_in text;
alter table signins add column if not exists walk_staff_initials text;
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

If you already have a `clients` table from an earlier version, add the photo column instead of recreating it:

```sql
alter table clients add column if not exists photo_data text;
```

Then add the `boardings` table (staff-created advance boarding reservations) and `meal_logs` (the per-day meal chart on `/report`):

```sql
create table boardings (
  id uuid primary key default gen_random_uuid(),
  dog_name text not null,
  last_name text not null,
  phone text not null,
  client_id uuid,
  start_date date not null,
  end_date date not null,
  feeding_instructions text,
  notes text,
  created_at timestamptz default now()
);
alter table boardings enable row level security;
create policy "allow all" on boardings for all using (true) with check (true);

create table meal_logs (
  id uuid primary key default gen_random_uuid(),
  boarding_id uuid references boardings(id) on delete cascade,
  date date not null,
  meal_type text not null,
  fed boolean not null default false,
  notes text,
  created_at timestamptz default now(),
  unique (boarding_id, date, meal_type)
);
alter table meal_logs enable row level security;
create policy "allow all" on meal_logs for all using (true) with check (true);
```

If you already have a `boardings` table from an earlier version, add the add-on columns (walk/bath/nail trim/medication) and the reservation photo column instead of recreating it:

```sql
alter table boardings add column if not exists addons text[] default '{}';
alter table boardings add column if not exists walks_per_day integer;
alter table boardings add column if not exists bath_size text;
alter table boardings add column if not exists medication_instructions text;
alter table boardings add column if not exists photo_data text;
```

Finally, the tables behind the staff profile pages, vaccine records, boarding walk log, and package usage history:

```sql
-- Owner-level details. `clients` is one row per DOG, so this is where the
-- person behind a phone number lives. Created lazily on first save.
create table owners (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  owner_name text,
  email text,
  address text,
  emergency_name text,
  emergency_phone text,
  emergency_relation text,
  notes text,
  created_at timestamptz default now()
);
alter table owners enable row level security;
create policy "allow all" on owners for all using (true) with check (true);

-- One row per (dog, vaccine). Fixed vaccine list — staff only fill in dates.
create table vaccinations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  vaccine text not null,
  given_on date,
  expires_on date,
  created_at timestamptz default now(),
  unique (client_id, vaccine)
);
alter table vaccinations enable row level security;
create policy "allow all" on vaccinations for all using (true) with check (true);

-- Per-day, per-slot walks for a boarding stay. A daycare walk is stored on
-- the signins row itself; a stay spans many days with several walks a day,
-- so it needs its own table.
create table walk_logs (
  id uuid primary key default gen_random_uuid(),
  boarding_id uuid references boardings(id) on delete cascade,
  date date not null,
  walk_index integer not null default 0,
  walk_out text,
  walk_in text,
  staff_initials text,
  created_at timestamptz default now(),
  unique (boarding_id, date, walk_index)
);
alter table walk_logs enable row level security;
create policy "allow all" on walk_logs for all using (true) with check (true);

-- Ledger of package days consumed, so usage has dates instead of just the
-- days_used counter on `packages`.
create table package_uses (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references packages(id) on delete cascade,
  client_id uuid,
  signin_id uuid,
  dog_name text,
  used_on date not null default current_date,
  created_at timestamptz default now()
);
alter table package_uses enable row level security;
create policy "allow all" on package_uses for all using (true) with check (true);

-- Pick-up window chosen at the kiosk when a bath is booked.
alter table signins add column if not exists pickup_window text;

-- Set by staff when a waiver was signed outside the kiosk (paper, another
-- location), so a dog added from an owner profile isn't flagged forever.
alter table clients add column if not exists waiver_on_file boolean default false;

-- `/report` records who fed each meal; earlier versions of this README
-- never created the column.
alter table meal_logs add column if not exists fed_by text;

-- What a client paid for a package. This is the revenue event: it counts on
-- the day the package was sold, and the visits it later covers are $0.
alter table packages add column if not exists price numeric;

-- The dog itself. All optional — kiosk signup only asks for the basics, and
-- these mostly arrive by importing an existing system's export.
alter table clients add column if not exists breed text;
alter table clients add column if not exists sex text;            -- male | female
alter table clients add column if not exists fixed_status text;   -- spayed | neutered | intact | unknown
alter table clients add column if not exists birthdate date;
alter table clients add column if not exists weight_lb numeric;
alter table clients add column if not exists vet text;
alter table clients add column if not exists authorized_pickup text;
alter table clients add column if not exists notes text;
alter table clients add column if not exists waiver_on_file boolean default false;

-- Address split out, since imports carry the parts separately.
alter table owners add column if not exists city text;
alter table owners add column if not exists state text;
alter table owners add column if not exists zip text;

-- App settings — prices, the add-on/service catalogs, and branding. One row,
-- enforced by the check constraint, holding a single JSON blob.
create table settings (
  id integer primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  constraint settings_singleton check (id = 1)
);
alter table settings enable row level security;
create policy "allow all" on settings for all using (true) with check (true);

-- Marks a visit that staff recorded on a client's behalf from the front
-- desk, rather than the client using the lobby kiosk themselves.
alter table signins add column if not exists by_staff boolean default false;

-- Set when staff confirm a waiver was signed somewhere other than the
-- kiosk signup flow (paper, another location), so a dog added from an
-- owner profile can still be marked as covered.
alter table clients add column if not exists waiver_on_file boolean default false;
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

Open http://localhost:3000 for the kiosk form and http://localhost:3000/signup for the one-time client signup/waiver. The staff pages all share one passcode: `/records` for saved sign-ins and the walk log, `/packages` for daycare packages, `/boardings` for reservations and the calendar, `/report` for a printable boarding stay report, and `/daily` for the end-of-day totals. Dog profiles (`/dogs/[id]`) and owner profiles (`/owners/[phone]`) aren't in the nav — click a dog's name on any staff page to open one.

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
   - **A visit only ever consumes a day from one package**, even when a household owns several. Which one is decided by `eligiblePackagesFor()` in [lib/clients.ts](lib/clients.ts): packages with days remaining rank above used-up ones, and within that, a package bought for this specific dog ranks above a shared one, newest first.
   - **Choosing between a household's packages is staff-only.** The lobby kiosk always takes the default above and just notes how many packages are on file — parents don't get a picker. To spend a day from a specific package, sign the dog out from the **front desk** panel (see below), whose per-dog **Package to draw from** dropdown lists each one with its remaining days ("Bella · 6 of 10 left", "Shared · 2 of 5 left"); used-up packages appear but can't be selected.
4. Phone numbers are auto-formatted as `(555) 123-4567` everywhere — the kiosk and the packages page both format as-you-type, so matching is reliable without staff needing to type it a specific way.

## Front desk — staff signing dogs in and out

Not every client uses the lobby kiosk. **`/records` → "🚗 Sign a dog in / out"** (also linked from the dashboard as *Front desk*) opens a staff panel that does it for them:

- Look up the client's phone number, then each dog on it shows whether it's currently **In** or **Out**, and the button flips to match — *Sign Buki in* or *Sign Buki out*.
- For a drop-off, staff pick the service and that dog's add-ons, plus the bath pick-up window when a bath is added. A dog with a reservation covering today is forced to boarding, same as the kiosk; picking Boarding without one is refused.
- For a pick-up, the service is locked to however the dog came in, and the panel says up front whether signing out now will spend a package day — and if not, why (under four hours, or not a daycare visit).
- Staff enter their own name, recorded as the drop-off/pick-up person, and the row is tagged `by_staff` so the records list can tell a front-desk entry from a client's own kiosk check-in.

**Both paths write through the same code.** `performSignIn()` in [lib/signin.ts](lib/signin.ts) is the single place a sign-in row is created, and [components/KioskForm.tsx](components/KioskForm.tsx) and [components/StaffCheckIn.tsx](components/StaffCheckIn.tsx) both call it — so package deduction, pricing, the usage ledger, and the PetExec push can't drift apart between the lobby and the front desk. The phone lookup is shared the same way via `loadPhoneContext()`.
5. `/packages` lets you edit a package's total day count anytime (Edit button), or manually nudge the used-days count up/down for corrections.

## Service locking and walk-in pricing

- **A dog can only be picked up under the service it was dropped off as** — daycare in means daycare out, boarding in means boarding out. The kiosk locks this automatically: at pick-up, each selected dog's service is read from their most recent open drop-off (see the lookup in `components/KioskForm.tsx` and the pricing math in `lib/pricing.ts`), shown as a badge, and the manual Service selector only reappears as a fallback for a dog with no open drop-off on file (a correction scenario). This lookup isn't limited to "today" — a boarding stay's drop-off can be several days before its pick-up.
- **A package only ever covers a FULL daycare day — never a half day, add-ons, or boarding.** Since a package day can only be decided once the actual visit length is known, package deduction happens at **pick-up**, not drop-off: if the visit turns out to be 4 hours or less, it's billed as a walk-in half day ($50) and no package day is used, even if one's on file. Walk/nail-trim/bath charges apply on top regardless of whether a package covers the base rate. Boarding never uses packages at all, so it always gets its full nightly + late-fee math.
- **A dog that's already signed in can't be dropped off again** — this is a hard block: the kiosk checks every selected dog against who's currently signed in before submitting, and refuses with a clear message (listing which dog(s)) until they're picked up first. The Sign In button itself disables and relabels to "Already signed in" the moment a duplicate is selected.
- **Pricing, defined in `lib/pricing.ts`:**
  - Daycare: **$70 full day**, or **$50 half day** if 4 hours or less between drop-off and pick-up.
  - Boarding: **$90/night** (partial nights round up to a full night), **+$50** if picked up at or after 12:00 PM (an extra half-day daycare fee for the late checkout). This is a **last-day charge only** — it's applied once, against the actual pick-up, so a running mid-stay estimate on `/records` never adds it just because the clock passed noon on an earlier day of the stay.
  - **Walk (+$30) and nail trim (+$25)** are added automatically the moment those add-ons are picked at drop-off.
  - **Bath is priced by size** — S ($60) / M ($80) / L ($100) — and **a bath with no size costs nothing**, so where the size comes from matters:
    - **A boarding reservation books a size**, so it's carried onto the sign-in row automatically at drop-off (both the kiosk and the front desk do this via `bathSize` in [lib/signin.ts](lib/signin.ts)). Nothing for staff to re-enter — the bath prices itself.
    - **A walk-in bath genuinely has no size** until staff pick one, since it depends on the dog. Assign it on `/records` any time, even mid-visit.
    - Until a size is set, `/records` shows a **⚠️ Set bath size to charge it** flag on that row. Without it, the bath is silently worth $0 and the client leaves undercharged — the flag is what makes that visible.
    - Once set, it's included everywhere automatically: the kiosk's pick-up screen picks it up on its next lookup, and it appears in the price breakdown on both the kiosk and `/records`.
  - Meet & greet has no defined price.
- **A 🧾 icon next to any price** (kiosk pick-up screen and `/records`) toggles a line-by-line breakdown — base rate, each add-on, bath if set — instead of just the total.
- **`/records` shows a live estimate before pick-up too**, not just after. A dog still signed in shows its running total (marked "(est.)") using the current time as a stand-in pick-up, recalculated on load — so staff can see roughly what's owed without waiting for the dog to actually leave. Once picked up, the number becomes final (and freely editable for adjustments); the printed report never shows this column either way.
- **Deleting an entry fully clears "signed in" status** — the kiosk's signed-in/locked-service lookup always reads live from the `signins` table with no caching, so once every row for a dog's visit is deleted (or once a normal pick-up is logged), that phone number stops showing the dog as signed in on the very next kiosk lookup.

## Boarding reservations

- `/boardings` (staff, same passcode as `/records`) is where advance boarding stays are created. Add a reservation with the dog's name, owner last name, phone, drop-off/pick-up dates, optional feeding instructions, and optional notes. Reservations can be edited or deleted any time from the same page.
- The page also shows a **month calendar** with every day's reservations as small pills (color-coded per stay) — click a day to see exactly who's booked that day. Below the calendar, an **upcoming & current** list (and a collapsed **past** list) gives the same info without needing to click through the calendar.
- **The kiosk checks this before allowing a boarding drop-off.** When a phone number is looked up and "Boarding" is selected as the service, each selected dog is checked against `boardings` for a reservation whose date range covers today. A dog with no matching reservation shows **"No reservation found"** on its card, and the Sign In button disables and relabels the same way it does for an already-signed-in dog — staff need to add the reservation on `/boardings` first. Daycare and meet & greet drop-offs are unaffected; only boarding requires a reservation on file.
- **Add-ons at the kiosk are chosen per dog**, not once for the whole sign-in — when two dogs from the same family drop off together, each gets its own bath/walk/nail-trim selection instead of both getting whatever was picked once.
- **A dog with a reservation covering today can only sign in as boarding.** The stay is already booked, so that dog's service is forced to Boarding regardless of the service selector — it can't be checked in as a daycare visit. Reserved dogs show a "🛏️ Boarding · reserved" badge.
- **Mixed sign-ins work**: one dog boarding on a reservation and another coming in for daycare can check in together. The service selector only governs the dogs *without* a reservation — when there's a mix it's labelled with their names ("Service for Max"), and the reserved dogs are called out separately above it. The "no reservation found" block only fires for a dog with nothing booked that's explicitly being signed in as boarding, so it never gets in the way of the mixed case.
- **A dog with a reservation covering today gets its add-ons pre-selected at the kiosk** from what staff booked, so the parent doesn't re-pick what was already agreed. They stay editable — tapping any chip changes that dog's selection and the change sticks. Only add-ons the kiosk offers are pre-filled; `medication` is staff-handled and never appears as a kiosk chip.
- **Looking up a phone number shows any reservation on file** for each selected dog — the stay's dates with the pick-up date called out, the add-ons booked (walks/day and bath size included), and the feeding instructions. A stay running today shows as "Boarding reservation on file"; if there's none today but one is booked ahead, the soonest future stay shows as "Upcoming boarding reservation" (information only — it doesn't pre-fill add-ons, since it isn't today's visit).
- Reservations can carry an optional **photo** (resized client-side before upload, stored the same way the signed waiver is) — it shows in the **Stay** section of that dog's `/report`. This is separate from the kiosk sign-in photo (see "Dog report" below) — one's tied to this specific stay, the other to the dog's profile.

## Dog and owner profiles

Two staff-only hub pages, reached by **clicking a dog's name anywhere in the app** (records, packages, the walk log) rather than from the nav. Hovering a dog's name first shows a summary card with their photo, vaccine status, package days left, and next stay.

**`/dogs/[id]` — the dog profile**

- **Photo** — this is where staff set the dog's picture (resized client-side, stored on `clients.photo_data`). Once set it shows on the kiosk sign-in/out card so parents recognize their dog at a glance; parents can see it but can't change it. *(This moved here from `/report`.)*
- **Basic info** — dog name, owner last name, and usual drop-off/pick-up person, editable inline.
- **Vaccines** — a fixed list (Rabies, DHPP, Bordetella, Canine influenza, Leptospirosis) with a date given and an expiry per vaccine. Each row gets a badge — *No record / Expired / Expiring soon (within 30 days) / Up to date* — and the worst status across all five is summarized in the page header. Dates save as you pick them.
- **Packages, boarding stays, visits, and walks** — each in its own capped-height scrollable table so the page stays scannable. Walks pull from both sources: daycare walks logged on the sign-in row, and boarding walks logged per day and slot.

**`/owners/[phone]` — the owner profile**

`clients` is one row per *dog*, so owner-level details live in their own `owners` table keyed by phone (created the first time you save one).

- Contact details (name, email, address) and a full **emergency contact** (name, phone, relationship) plus staff notes.
- **Every dog on that number**, as photo cards linking to their profiles — and this is where staff **add, edit, or remove a dog** on the account. "+ Add a dog" takes a name, owner surname (pre-filled from the household), and usual drop-off person; Edit changes those three inline; Delete removes the dog.
- A dog added here has **no signed signature** — the `/signup` flow is what captures one. The add/edit form has a **"Waiver signed and on file"** checkbox for waivers signed elsewhere (on paper, or at another location); ticking it clears the flag without fabricating a signature, and the card then reads *Waiver on file (paper)* to keep the two cases distinguishable. Untouched, the dog shows *No waiver on file* on both its card and its profile header. `hasWaiver()` in [lib/clients.ts](lib/clients.ts) is the single check — a real signature counts on its own.
- **Renaming a dog carries across to its reservations and packages.** Those are matched by name rather than by id, so a rename that didn't cascade would silently orphan a dog's stays and package days. The update is scoped to that phone number.
- **Deleting a dog** removes its profile, photo, and vaccine records. Past sign-ins and reservations stay in the records for bookkeeping but stop being linked to a profile — the confirmation says so, and names how many reservations are affected, before you commit.
- **Upcoming reservations across all their dogs**, and every package on the number.

## Boarding stay report (printable PDF)

- `/report` (staff, same passcode) is now **exclusively about one boarding stay**. Searching a phone number lists only dogs that have stays; dogs without one are offered as links to their profile instead, which is where their details and daycare history live.
- The page shows: a compact read-only header (photo, name, link to the full profile), the stay's dates/feeding instructions/notes/medication, a **walk log**, a **meal log chart** (breakfast, lunch, dinner, snack — tap to mark fed, records who fed), sign-in/out times scoped to the stay, and the **charges breakdown and total**.
- **The walk log is now saved, not just printed.** It has a row per day and a column per walk (following the reservation's walks/day), each with out / back / initials. Entries save as you type into `walk_logs` and also show on the dog's profile. Anything left blank still prints as a dotted line to fill in by hand.
- **The total always includes the nightly boarding rate**, not just add-ons — it's computed from the reservation itself (`estimateBoardingTotal`), so it's correct mid-stay, before a pick-up has recorded a final price.
- A reservation can carry its own photo (added on `/boardings`), shown in the **Stay** section — separate from the profile photo, since a dog has one current kiosk photo but can have a different photo per stay.
- **Print / Save as PDF** opens the browser's print dialog, same as `/records`.

## Dashboard — what's on today

`/dashboard` is the staff hub. It answers "what does today hold?", deliberately **without showing money** — it's the screen most likely to be open on a shared machine near clients, so revenue lives only on `/daily`.

- Headline counts: **in house**, **still to arrive**, **dropped off**, **picked up**.
- **Services scheduled** — a bar chart of *counts*: walks, baths, nail trims, medications. Walks and medications count for every stay covering today (a stay with 2 walks/day contributes 2); one-off grooming on a boarding stay counts on the day the dog **goes home**, since that's when a dog is bathed before pick-up.
- **Dogs by service** — daycare / boarding / meet & greet. Tap a bar to open that service's sign-in list for the day.
- A **Revenue & printable report →** link is the only route to the money.

**Boarding add-ons are counted from the reservation, never the sign-in row.** The kiosk copies a stay's booked add-ons onto its drop-off row so the parent can see them, so counting both places would tally every boarding walk twice — and price it twice, at two different rates ($30 walk-in vs $25/walk boarding). `computeDailyTotals()` in [lib/daily.ts](lib/daily.ts) skips boarding drop-offs when summing sign-in add-ons for exactly this reason.

## End-of-day report

- `/daily` (staff, same passcode) totals a day's business: **revenue**, dogs dropped off, dogs picked up, and package days used, with a date picker defaulting to today. This is the only page that shows dollar amounts.
- **Revenue by category** — daycare (full vs half day), boarding nights, walks, baths, and nail trims — shown as a bar chart plus a table with counts. Amounts come from the existing prices in `lib/pricing.ts`, so there's no second source of truth: daycare is counted at pick-up (when the visit's length, and so its rate, is known), add-ons from the drop-off row, and boarding as one night per stay covering that date.
- Visits covered by a package are excluded from revenue, since no money changed hands.
- If the total differs from what was actually charged at pick-up, the page says so and explains why — boarding accrues per night rather than at checkout, and staff can hand-edit a price on `/records`.
- The charts are plain inline SVG (no charting library), so they print exactly as they render.

## Records and daily PDF

- `/records` shows one row per dog per day, with separate drop-off and pick-up time columns — unchanged from before. The only related update: since packages can now be tied to a specific dog, the package column matches a dog-specific package first and falls back to a shared one, instead of just picking the newest package for that phone number regardless of which dog it was for.
- **Grouped by service** by default: rows are sorted into Daycare, then Boarding, then Meet & greet sections (each with a small header row), instead of one flat list sorted purely by time. This applies on-screen and on the printed report.
- **A Status column shows at a glance who's still here.** A dog with a drop-off and no pick-up after it reads **🟢 In**, and its whole row gets a green left edge and a faint tint so the dogs on site are scannable without reading the times columns. A dog that's gone reads **✓ Left**. A count — *🟢 3 still here* — sits next to the page title. Status is derived from the drop-off/pick-up times rather than stored, so correcting a time on a row updates it automatically.
- **Sortable columns.** Click a column header to sort by it — dog, status, last name, phone, drop-off by, drop-off time, picked-up by, pick-up time, or price. Sorting by **status** puts the dogs still on site first, which is the list staff actually act on. First click sorts ascending, second descending, third returns to the grouped default. The active column is highlighted with ▲/▼, and a *Sorted by …* chip above the table shows the current sort with a one-click way back to grouping.
  - Sorting **replaces the service grouping**, since interleaved rows would fragment the group bands. So the service moves onto each row as a small badge next to the dog's name — the information isn't lost, just relocated.
  - **Blank cells always sort last, in both directions.** A dog still on site has no pick-up time and no final price; treating those as zero would rank them "earliest" or "cheapest" and float them to the top when the column is reversed. `compareBy()` in [app/records/page.tsx](app/records/page.tsx) applies direction only to real values.
  - Sorting by **price** uses whatever the row displays — the final price once set, otherwise the running estimate — so the order matches what's on screen.
  - Headers print as plain text; a print-out has no sort affordance.
- Each row has **Edit** (last name, drop-off-by, picked-up-by, service, add-ons, and the actual drop-off/pick-up times) and **Delete**. Delete removes every underlying record for that dog/day — including any duplicate sign-ins from before the kiosk's "already signed in" warning existed, not just the most recent drop-off/pick-up pair.
- Pick a date with the date picker (defaults to today), then **Print / Save as PDF** opens your browser's print dialog — unchanged. Choose "Save as PDF" as the destination to get a PDF formatted like the on-screen list.
- A **🚶 Walk log** toggle switches the page to a printable list of every walk owed that day, **grouped by daycare and boarding**. Daycare dogs appear once each (their walk saves onto the sign-in row); boarding dogs appear once per walk slot, following their reservation's walks/day, saving into `walk_logs` — the same entries the stay report shows. Walk out/in and staff initials are editable inline and save on blur, so staff can fill it in digitally; anything left blank still prints as a dotted line.
- When a parent books a bath at the kiosk they pick a **pick-up window**, which shows under that dog's add-ons here so grooming knows when the dog is due back out front.

## Packages

- `/packages` uses the same **phone lookup and multi-dog picker** as `/boardings` — type the number, tap which dogs the package is for, and one package is created per dog. A **shared** checkbox instead creates a single package with no dog attached, covering every dog on that number (the original behaviour).
- Packages are split into **active** and a collapsed **used-up** list.
- Each package shows a **usage history** — tap the 🗓️ button to see the dates its days were consumed. The kiosk records a row every time it deducts a day at pick-up, and the manual *Use a day* / *Undo* buttons keep that history in step. Days consumed before this history existed aren't listed, but the remaining-days count is still correct.
- *Use a day* and *Undo* were previously wired backwards (the ➕ button consumed a day); they're now labelled by what they actually do. The "edit total" control, which existed in code but had no button, is now reachable.

### Package pricing

- **Selling a package is the revenue event.** The client pays the package price up front instead of a daycare fee, so `packages.price` is counted as revenue on the day of sale, and the visits it later covers are $0 — the money was already taken. That's why *Packages sold* is its own line on `/daily`.
- **Prices come from configured tiers, not free-hand typing.** The blocks you sell (5 days / $325, 10 / $600, 20 / $1100 by default) are set on **Settings → Package pricing**. Selling is then one tap on a tier, which fills in both the days and the price. A **Custom…** option is still there for one-offs.
- Each tier shows its effective per-day rate, and the settings editor **flags a tier priced at or above the walk-in day rate** — that's a tier a client has no reason to buy, and it's easy to create by accident when the walk-in rate changes.
- Packages sold before prices were recorded show *no price recorded* rather than a misleading $0, so they don't quietly understate revenue.

## Settings

`/settings` (staff, same passcode) is where the app's own configuration lives. Everything here used to be hardcoded and needed a redeploy to change.

- **Business** — name, tagline, and a logo upload. These drive the kiosk header; the logo falls back to the bundled one when empty.
- **Daycare & boarding rates** — full/half day, the half-day cutoff in hours, nightly boarding, and the late pick-up fee and hour.
- **Bath prices** by size, **daycare add-ons** (add your own, with prices), **package tiers**, and **boarding add-on rates**.
- **Services** can be renamed and re-iconed. Adding a genuinely new service type still needs code — daycare, boarding, and meet & greet each have their own pricing and booking rules — and the page says so rather than offering a button that half-works.
- Built-in add-ons can be edited but **not deleted**: bath has sizes, walk feeds the walk log, medication is boarding-only, and code depends on those keys existing. Custom add-ons get a stable key derived from their name at creation, so renaming one later doesn't orphan the values already written into `signins.addons`.
- Edits are a **local draft** — nothing reaches the kiosk until you hit Save.

Implementation note: prices are read through getter objects (`PRICING.daycareFullDay`, `BATH_PRICES[size]`) backed by a settings cache hydrated once at startup by `SettingsProvider`. That kept every call site unchanged and, more importantly, left `estimatePrice()` and the rest of [lib/pricing.ts](lib/pricing.ts) pure and synchronous — making them async would have rippled through every page. If the `settings` table is missing or Supabase is unreachable, `loadSettings()` logs and keeps the shipped defaults, so the kiosk still opens.

## Staff navigation & passcode timeout

- `/records`, `/boardings`, `/report`, `/packages`, and `/daily` share a nav bar at the top of each page — `/records` is the hub staff land on, with links to jump to the others (and back to the kiosk). Dog and owner profiles are deliberately not in the nav; they're reached by clicking a dog's name.
- The passcode unlock is **shared across every staff page** for 30 minutes at a time (`NEXT_PUBLIC_STAFF_UNLOCK_MINUTES` env var to change it) — unlocking once and navigating between pages doesn't re-prompt, but it locks again automatically after that long without a staff page being open.

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
- No staff page is linked from the kiosk — bookmark `/records` on a staff device. Every other staff page is reachable from its nav bar once unlocked, so one bookmark is enough.
- Owner profiles are keyed by phone number, which is how the whole app already identifies a client. A client changing their number breaks the link between their dogs, same as it does everywhere else in the app — re-save the dogs under the new number if that happens.
