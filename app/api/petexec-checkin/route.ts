import { NextRequest, NextResponse } from "next/server";
import { getPetIdForPhone, markPetExecPickup, schedulePetExecDaycare } from "@/lib/petexec";

// -----------------------------------------------------------------------
// Pushes a kiosk sign-in/out over to PetExec so their system reflects it
// too. Runs server-side (not in the browser) so PetExec credentials never
// ship in client JS.
//
// STATUS: the underlying PetExec calls (schedulePetExecDaycare,
// markPetExecPickup — see lib/petexec.ts) are built against confirmed API
// docs. This route can't actually use them yet because getPetIdForPhone()
// is still a stub — every PetExec Daycare call needs their internal petid,
// and that lookup-by-phone endpoint hasn't been found in the docs yet
// (likely under an "Owner" or "Pet" section). Once that's filled in, this
// route works end to end.
//
// PETEXEC_DAYCARE_SERVICE_ID also needs to be set once you know which of
// PetExec's daycare service IDs (from GET /daycare/services) represents a
// standard kiosk drop-off — the kiosk's own service/add-on picker doesn't
// map cleanly onto PetExec's more granular service catalog, so for now
// every kiosk drop-off uses one representative service ID.
//
// Until PetExec credentials are configured, this route no-ops and returns
// { skipped: true } — the kiosk's own Supabase save is unaffected either
// way, so nothing breaks by leaving this unconfigured.
// -----------------------------------------------------------------------

interface CheckinPayload {
  dogName: string;
  lastName: string;
  phone: string;
  action: "drop_off" | "pick_up";
  serviceType: string;
}

function nowAsPetExecTime(): string {
  // PetExec's examples use "03:00 PM" style — matches toLocaleTimeString's
  // default en-US hour:minute + AM/PM shape closely enough to start from.
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export async function POST(req: NextRequest) {
  let body: CheckinPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const petId = await getPetIdForPhone(body.phone);
  if (petId === null) {
    // Either PetExec isn't configured, or (right now, always) the
    // phone→petid lookup isn't implemented yet.
    return NextResponse.json({ skipped: true, reason: "PetExec petid lookup not yet available" });
  }

  if (body.action === "drop_off") {
    const serviceId = Number(process.env.PETEXEC_DAYCARE_SERVICE_ID ?? NaN);
    if (Number.isNaN(serviceId)) {
      return NextResponse.json({ skipped: true, reason: "PETEXEC_DAYCARE_SERVICE_ID not set" });
    }
    const today = new Date().toLocaleDateString("en-US"); // MM/DD/YYYY
    const result = await schedulePetExecDaycare({
      petId,
      date: today,
      dropOffTime: nowAsPetExecTime(),
      daycareServiceId: serviceId,
    });
    return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.error }, {
      status: result.ok ? 200 : 502,
    });
  }

  // Pick-up: TODO — needs today's PetExec daycareid for this pet, found
  // via the signed-in-daycares list filtered to this pet/owner. Not wired
  // up yet; markPetExecPickup(daycareId, time) is ready once that lookup
  // exists.
  return NextResponse.json({ skipped: true, reason: "Pick-up sync not yet implemented" });
}
