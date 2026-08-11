# Security requirements — where the app actually stands

Assessed against the client's requirements document. Verified against the
running code and the live database rather than from memory. Written to be
shown to the client as-is.

**Headline:** the infrastructure requirements are largely met — Supabase,
Supabase Auth, TLS, encryption at rest, no custom cryptography, no card data.
The **access-control requirements are largely not met**, because the app has
no roles and no customer accounts. Everyone who signs in is simply
"authenticated", and the database grants that identity everything.

That single fact is what fails requirement 1's isolation clause, all of
requirement 3, the MFA parts of requirement 2, and the Primary Security
Objective. It is one piece of work, not four.

---

## 1. Backend & database

| Requirement | Status |
|---|---|
| Supabase + PostgreSQL | **Met** |
| No self-hosted database | **Met** |
| RLS on every table with customer/pet data | **Met** — verified in force: the public key reads settings only, is refused every other table, and may insert into the two form tables |
| Customers cannot reach another customer's data | **Not met** — there is no customer role and no customer account. Nothing in the database distinguishes one customer from another |
| Production and development separated | **Not met** — one Supabase project; local development points at the production database. Mitigating factor today: the 495 imported owner records are synthetic test data, not real customers, so no live customer information is currently exposed to development. That stops being true the day the business goes live, so the separation must exist before launch rather than after |

## 2. Authentication

| Requirement | Status |
|---|---|
| Supabase Auth, no custom auth | **Met** — real accounts; the old shared passcode was removed |
| Passwords never stored by the app | **Met** |
| MFA for Owner/Admin | **Not met** |
| MFA for Managers and broad-access staff | **Not met** — and cannot be until roles exist |

Note for a reviewer: `lib/staffAuth.ts` keeps an "unlocked recently" timestamp
in local storage. It is a convenience that avoids re-prompting between staff
pages; it is **not** the security boundary. Every request still carries a
Supabase session and RLS decides. Worth explaining before someone flags it.

## 3. User permissions — the main gap

**No role-based access control exists.** There is one class of signed-in user.
RLS grants `authenticated` full read and write on every table.

Consequences today:

- An employee can read every customer record, every payment and every balance.
- An employee can **export the entire customer database** — Settings → Reports
  offers CSV downloads of dogs, owners, visits, boardings, packages, payments
  and vaccinations. The requirement says this needs specific authorisation.
- There is no Customer role. Customers never sign in; enrollment and boarding
  requests are anonymous form submissions.

Required: Owner/Admin, Manager, Employee, Customer — enforced in RLS policies,
not only in the interface.

## 4. Encryption

| Requirement | Status |
|---|---|
| HTTPS/TLS everywhere | **Met** — Supabase is TLS-only |
| Encrypted at rest | **Met** — provided by the platform |
| No proprietary encryption | **Met** — none written |

## 5. Payments (future)

| Requirement | Status |
|---|---|
| PCI-compliant provider | **Met** — Square |
| Card numbers and CVV never stored | **Met** — the integration is a deep link into the Square app; no card data is entered into or returned to this application |
| Store only IDs, amount, date, status | **Met in shape** — payments hold amount, date and phone |

## 6. Documents & photos

| Requirement | Status |
|---|---|
| Documents in private storage, not public URLs | **Met, with a caveat** |
| Same authorisation rules as the account | **Partly** |
| No access by changing a URL | **Met** |

Vaccination records and dog photos are stored **inside database rows**, behind
RLS. There is no public URL to guess, so the URL-manipulation attack does not
apply. This was a deliberate decision: a public `site-photos` bucket exists,
but it holds **only marketing images** — the website gallery, hero photos, the
logo and team headshots. Customer documents were deliberately kept out of it.

The caveat: "same authorisation rules as the customer's account" cannot be
satisfied while customers have no accounts. See requirement 3.

## 7. API & secret keys

| Requirement | Status |
|---|---|
| No secrets in frontend code | **Met** — verified: `SUPABASE_SECRET_KEY` appears nowhere in application code; `RESEND_API_KEY` is read only inside a server route |
| No secrets in the repository | **Met** — `.env.local` is git-ignored |
| Only frontend-safe keys in frontend code | **Met** — the anon key is the one designed for this |

One thing to note rather than fix: the `settings` table is publicly readable
because the marketing website reads prices and branding from it. It therefore
also exposes the Square **application and location IDs**. Those are publishable
identifiers, not secrets — but a narrower public view would be tidier.

## 8. Backups & recovery

**Not verified.** Depends on the Supabase plan; the free tier has no
point-in-time recovery. Needs confirming, and a restore needs rehearsing once
so the procedure is known to work.

## 9. Logging & monitoring

**Not met.** There is no audit log. Nothing records admin sign-ins, permission
changes, staff edits to customer accounts, or data exports.

## 10. Data collection

**Met.** Names, addresses, phones, emails, pet details, vaccinations,
reservations. No Social Security numbers, licences or financial accounts.
Signatures are captured for the waiver, which is the point of a waiver.

## 11. Third-party services

**Largely met.** Supabase, Square, Resend, and pdf.js — each with a clear
purpose. No analytics, no advertising, no session recording, no pixels.

One to raise: the website falls back to **Unsplash-hosted placeholder images**
until real photos are uploaded, so visitors' browsers contact a third party.
Harmless, but it is a third party, and it disappears once the business uploads
its own photographs.

## 12. Security testing before launch

**Not done.** None of the listed tests have been performed formally. Note that
several of them cannot pass until roles exist — customer-to-customer isolation
cannot be tested where there are no customers.

## 13. Development principle

**Met.** Nothing security-critical was hand-rolled: authentication and session
handling are Supabase, payments are Square, encryption is the platform's, and
database security is RLS.

---

# What has to be built

In dependency order. The first item unblocks most of the rest.

1. **Roles and RLS enforcement** — Owner/Admin, Manager, Employee. A role on
   each account, and policies written per table so the database refuses what
   the interface would not offer. Restrict the bulk exports to authorised
   roles.
2. **MFA** for Owner/Admin and Manager, via Supabase Auth's built-in TOTP.
3. **Audit log** — a table plus writes at the points that matter: sign-ins,
   permission changes, staff edits to customer records, exports.
4. **Environment separation** — a development Supabase project, so nobody
   develops against live customer data.
5. **Customer accounts** — the largest item, and the one that makes
   "customers cannot see each other's data" a testable statement rather than a
   vacuous one. Needs a customer portal: sign in, see your own dogs,
   reservations and documents.
6. **Backups verified**, with a rehearsed restore.
7. **The testing checklist in requirement 12**, run and recorded, once the
   above exists.

Items 1–3 are what move the app from "no answer" to "defensible" on the
Primary Security Objective. Item 5 is a product decision as much as a security
one, since it adds a whole customer-facing surface.
