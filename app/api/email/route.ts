import { NextRequest, NextResponse } from "next/server";

// -----------------------------------------------------------------------
// Sends client-facing email — the enrollment acknowledgement, and whatever
// staff write when they approve or decline a request.
//
// Runs server-side so the provider key never ships in client JS. It talks
// to Resend's REST API over plain fetch rather than pulling in their SDK,
// which keeps the dependency list where it is.
//
// SETUP (once per deployment):
//   1. Create a free account at resend.com and verify your sending domain.
//   2. Put the API key in .env.local as RESEND_API_KEY=re_...
//   3. Set the From address on /settings — it must be on the verified
//      domain, or Resend rejects the send.
//
// Until RESEND_API_KEY is set this route no-ops and returns
// { skipped: true }. Nothing else in the app depends on the result, so an
// unconfigured install still enrolls and approves clients exactly as
// before — it just doesn't email anyone.
// -----------------------------------------------------------------------

interface EmailPayload {
  to: string;
  subject: string;
  // Plain text, as typed by staff. Turned into HTML here so line breaks
  // survive; the text version goes along for clients that prefer it.
  body: string;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(req: NextRequest) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY is not set" });
  }

  let payload: EmailPayload;
  try {
    payload = (await req.json()) as EmailPayload;
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const to = (payload.to ?? "").trim();
  const subject = (payload.subject ?? "").trim();
  const body = payload.body ?? "";
  if (!to || !subject || !body.trim()) {
    return NextResponse.json({ error: "Need a recipient, a subject and a message." }, { status: 400 });
  }

  const address = (payload.fromAddress ?? process.env.EMAIL_FROM ?? "").trim();
  if (!address) {
    return NextResponse.json(
      { error: "No From address configured — set one under Settings → Email." },
      { status: 400 }
    );
  }
  const from = payload.fromName ? `${payload.fromName} <${address}>` : address;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: body,
        html: `<div style="font:14px/1.6 -apple-system,Segoe UI,sans-serif;color:#1e1d1a">${escapeHtml(
          body
        ).replace(/\n/g, "<br>")}</div>`,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      // Resend puts the useful part in a JSON `message`. Unwrap it so staff
      // see "The gmail.com domain is not verified" rather than a wall of
      // JSON, and fall back to the raw body if the shape ever changes.
      const raw = await res.text();
      let detail = raw;
      try {
        const parsed = JSON.parse(raw) as { message?: string };
        if (parsed.message) detail = parsed.message;
      } catch {
        // not JSON — keep the raw text
      }
      console.error("Resend rejected the send:", res.status, raw);
      return NextResponse.json({ error: detail || `Send failed (${res.status})` }, { status: 502 });
    }

    return NextResponse.json({ sent: true });
  } catch (e) {
    console.error("Sending email failed:", e);
    return NextResponse.json({ error: "Could not reach the email provider." }, { status: 502 });
  }
}
