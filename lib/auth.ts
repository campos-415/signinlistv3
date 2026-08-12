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
import { logSignIn, logSignOut } from "@/lib/audit";
import { forgetCachedRole } from "@/lib/roles";
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

    // A different account may have been signed in a moment ago, and the
    // cached role belongs to that one.
    forgetCachedRole();

    // Requirement 9 asks for a record of admin sign-ins. Written after the
    // session exists, because the database attributes the entry to the
    // session rather than believing what the browser says about who it is.
    //
    // Only successful sign-ins are recorded here, and a failed one cannot
    // be: there is no session to attribute it to, and letting a signed-out
    // caller write to the log would hand anybody on the internet a way to
    // fill it with noise. Supabase Auth keeps its own record of every
    // attempt including the failures, in auth.audit_log_entries.
    await logSignIn();

    return { ok: true };
  } catch (e) {
    console.error("Sign-in failed:", e);
    return { ok: false, error: "Could not reach the server. Check the connection." };
  }
}

export async function signOut(): Promise<void> {
  try {
    // Before, not after: once the session is gone there is nobody for the
    // database to attribute the entry to and the write is refused.
    await logSignOut();
    forgetCachedRole();
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
