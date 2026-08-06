// -----------------------------------------------------------------------
// PetExec uses OAuth2 Password Grant for server-side apps. Confirmed
// against https://secure.petexec.net/api's own docs (Authenticate > Get
// Access Token - Password Grant):
//
//   POST https://secure.petexec.net/api/token
//   Header: Authorization: Basic base64(client_id:client_secret)
//   Body:   grant_type=password, username, password, scope
//   Response: { access_token, expires_in, token_type, scope, refresh_token }
//
// client_id/client_secret come from registering an "API Application" in
// PetExec under Company Preferences → Misc. Settings → Maintain API
// Applications. username/password are a real PetExec staff login.
// -----------------------------------------------------------------------

const PETEXEC_BASE_URL = process.env.PETEXEC_BASE_URL || "https://secure.petexec.net/api";

// Space-separated scopes this app actually needs. Keep in sync with the
// scopes checked when the API Application was registered in PetExec.
const PETEXEC_SCOPE = "owner_read pet_read daycare_create daycare_update";

interface CachedToken {
  accessToken: string;
  expiresAt: number; // ms epoch
}

let cachedToken: CachedToken | null = null;

export async function getPetExecToken(): Promise<string | null> {
  const clientId = process.env.PETEXEC_CLIENT_ID;
  const clientSecret = process.env.PETEXEC_CLIENT_SECRET;
  const username = process.env.PETEXEC_USERNAME;
  const password = process.env.PETEXEC_PASSWORD;

  if (!clientId || !clientSecret || !username || !password) {
    return null; // not configured yet
  }

  // Reuse the cached token if it's still valid for another 60s.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${PETEXEC_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: "password",
      username,
      password,
      scope: PETEXEC_SCOPE,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("PetExec token request failed:", response.status, text);
    return null;
  }

  const data = await response.json();
  const accessToken: string | undefined = data.access_token;
  const expiresIn: number = data.expires_in ?? 3600;

  if (!accessToken) {
    console.error("PetExec token response missing access_token:", data);
    return null;
  }

  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return accessToken;
}

export function petexecBaseUrl(): string {
  return PETEXEC_BASE_URL;
}

// -----------------------------------------------------------------------
// Daycare endpoints — confirmed against secure.petexec.net/api docs.
// -----------------------------------------------------------------------

interface PetExecDaycareServices {
  daycareservices: { serviceid: number; servicename: string; price: string }[];
  lunchservices: { serviceid: number; servicename: string; price: string }[];
}

export async function getPetExecDaycareServices(): Promise<PetExecDaycareServices | null> {
  const token = await getPetExecToken();
  if (!token) return null;

  const response = await fetch(`${PETEXEC_BASE_URL}/daycare/services`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    console.error("PetExec get daycare services failed:", response.status, await response.text());
    return null;
  }
  const data = await response.json();
  return { daycareservices: data.daycareservices ?? [], lunchservices: data.lunchservices ?? [] };
}

interface ScheduleDaycareOptions {
  petId: number;
  date: string; // MM/DD/YYYY — used as both startDate and endDate for a same-day walk-in
  dropOffTime: string; // e.g. "03:00 PM"
  daycareServiceId: number; // from getPetExecDaycareServices()
  napRequired?: boolean;
  note?: string;
}

// POST /daycare — creates a same-day daycare appointment. This is what we
// call on kiosk drop-off. Confirmed shape: startDate == endDate means
// daysOfWeek isn't required (per the docs note on that endpoint).
export async function schedulePetExecDaycare(
  opts: ScheduleDaycareOptions
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getPetExecToken();
  if (!token) return { ok: false, error: "not configured or auth failed" };

  const body = new URLSearchParams({
    petids: String(opts.petId),
    startDate: opts.date,
    endDate: opts.date,
    dropOffTime: opts.dropOffTime,
    [`daycare_${opts.petId}`]: String(opts.daycareServiceId),
  });
  if (opts.napRequired !== undefined) body.set(`nap_${opts.petId}`, opts.napRequired ? "1" : "0");
  if (opts.note) body.set(`note_${opts.petId}`, opts.note);

  const response = await fetch(`${PETEXEC_BASE_URL}/daycare`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("PetExec schedule daycare failed:", response.status, text);
    return { ok: false, error: text };
  }
  return { ok: true };
}

// PUT /daycare/:daycareid — used on kiosk pick-up to set pickUpTime on
// today's existing appointment. Requires PetExec's internal daycareid,
// which means finding today's signed-in record for this pet first — see
// the TODO on findTodaysDaycareId below.
export async function markPetExecPickup(
  daycareId: number,
  pickUpTime: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getPetExecToken();
  if (!token) return { ok: false, error: "not configured or auth failed" };

  const response = await fetch(`${PETEXEC_BASE_URL}/daycare/${daycareId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${token}`,
    },
    body: new URLSearchParams({ pickUpTime }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("PetExec mark pickup failed:", response.status, text);
    return { ok: false, error: text };
  }
  return { ok: true };
}

// -----------------------------------------------------------------------
// TODO — NOT YET IMPLEMENTED. Every call above needs PetExec's internal
// petid, and we don't have the lookup yet. This almost certainly lives
// under an "Owner" or "Pet" section in the same API docs sidebar (likely
// tied to the owner_read / pet_read scopes already granted on the API
// Application) — something like "Get an owner" or "Get owner's pets" by
// phone number, email, or name. Screenshot that section the same way and
// this function can be filled in.
// -----------------------------------------------------------------------
export async function getPetIdForPhone(_phone: string): Promise<number | null> {
  return null; // stub
}
