import type { Metadata } from "next";
import PortalChrome from "@/components/PortalChrome";

// The client portal, in a route group of its own.
//
// The reason it is a group rather than a few pages under the back office is
// containment. The staff side has StaffNav, the idle lock, dark mode and a
// set of links that assume the person reading is staff; none of that should
// be one careless import away from a screen a client is looking at. A route
// group gives the portal its own layout, its own header, and no path back
// into the other one.
//
// It also keeps the SEO right. The marketing site wants to be indexed and
// this does not.
export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalChrome>{children}</PortalChrome>;
}
