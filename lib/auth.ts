// Real sign-in, replacing the shared passcode.
//
// The passcode it replaces was checked in the browser against a
// NEXT_PUBLIC_ env var, which meant it shipped inside the JavaScript — you
// could read it in dev tools. Worse, it guarded nothing but the UI: the
// database was reachable directly with the anon key.
//
// Now every staff and kiosk request carries a Supabase session token, and
// Row Level Security is what actually decides who can read what (see
// rls-lockdown.sql). No query in the app changed — supabase-js attaches the
// token itself.

import { getSupabase } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";

// Supabase identifies users by email. Staff would rather type "frontdesk"
// than "frontdesk@…", so a value with no @ is expanded to this domain. It
// never receives mail — it only has to be a syntactically valid address.
export const STAFF_EMAIL_DOMAIN = "staff.local";

export function toEmail(usernameOrEmail: string): string {
  const v = usernameOrEmail.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${STAFF_EMAIL_DOMAIN}`;
}

export interface SignInResult {
  ok: boolean;
  error?: string;
}

export async function signIn(usernameOrEmail: string, password: string): Promise<SignInResult> {
  if (!usernameOrEmail.trim() || !password) {
    return { ok: false, error: "Enter a username and password." };
  }
  try {
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email: toEmail(usernameOrEmail),
      password,
    });
    if (error) {
      // Deliberately vague: saying which half was wrong tells an attacker
      // which usernames exist.
      return { ok: false, error: "That username and password don't match." };
    }
    return { ok: true };
  } catch (e) {
    console.error("Sign-in failed:", e);
    return { ok: false, error: "Could not reach the server. Check the connection." };
  }
}

export async function signOut(): Promise<void> {
  try {
    await getSupabase().auth.signOut();
  } catch (e) {
    console.error("Sign-out failed:", e);
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}

/** The name to show in the UI — the username half, not the synthetic email. */
export function displayName(user: User | null | undefined): string {
  const email = user?.email ?? "";
  if (!email) return "Signed in";
  return email.endsWith(`@${STAFF_EMAIL_DOMAIN}`) ? email.split("@")[0] : email;
}
