// Which half of the app a path belongs to.
//
// The deployment serves two things: a public marketing website at the root,
// and the kiosk plus back office underneath it. Several behaviours differ
// between them — dark mode, the runtime tab title — and each needs the same
// answer, so the list lives here rather than being restated per component.

/** The back office. Staff-only, and the only place dark mode applies. */
export const STAFF_ROUTES = [
  "/dashboard",
  "/in-house",
  "/calendar",
  "/packages",
  "/requests",
  "/enrollments",
  "/boarding-requests",
  "/day-report",
  "/stay-report",
  "/settings",
  "/dogs",
  "/owners",
];

/** The lobby kiosk and the forms clients fill in. Public, but not marketing. */
export const APP_ROUTES = ["/kiosk", "/signup", "/enroll", "/book"];

function matches(pathname: string | null, routes: string[]): boolean {
  if (!pathname) return false;
  return routes.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

export function isStaffRoute(pathname: string | null): boolean {
  return matches(pathname, STAFF_ROUTES);
}

/**
 * True for anything that is part of the application rather than the
 * marketing website. The website owns its own page titles for SEO, so the
 * runtime white-label title is only applied here.
 */
export function isAppRoute(pathname: string | null): boolean {
  return isStaffRoute(pathname) || matches(pathname, APP_ROUTES);
}
