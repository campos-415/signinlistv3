// Client-side helpers for the email route. The templates and the From
// address live in settings so a business can reword everything without a
// deploy; the provider key stays server-side in app/api/email/route.ts.

import { getSettings } from "@/lib/settings";

export interface SendResult {
  sent: boolean;
  skipped?: boolean;
  error?: string;
}

// Placeholders staff can use in a template. Anything unknown is left alone
// rather than blanked, so a typo shows up in the preview instead of
// silently deleting a sentence.
export type TemplateVars = Record<string, string>;

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    key in vars ? vars[key] : whole
  );
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  body: string;
  // Overrides the saved sender. Only the settings page uses this, so a
  // test send reflects the addresses being edited rather than the ones
  // last saved — otherwise "send a test" would quietly test the old value.
  from?: { fromName?: string; fromAddress?: string; replyTo?: string };
}): Promise<SendResult> {
  const { email, business } = getSettings();
  const { from, ...message } = input;
  try {
    const res = await fetch("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...message,
        fromName: from?.fromName || email.fromName || business.name,
        fromAddress: from?.fromAddress || email.fromAddress,
        replyTo: from?.replyTo || email.replyTo || undefined,
      }),
    });
    const data = (await res.json()) as { sent?: boolean; skipped?: boolean; error?: string };
    if (data.skipped) return { sent: false, skipped: true };
    if (!res.ok) return { sent: false, error: data.error ?? `Send failed (${res.status})` };
    return { sent: !!data.sent };
  } catch (e) {
    console.error("Email request failed:", e);
    return { sent: false, error: "Could not reach the email service." };
  }
}
