import type { Metadata, Viewport } from "next";
import { Fredoka, Inter } from "next/font/google";
import "./globals.css";
import SettingsProvider from "@/components/SettingsProvider";
import { ThemeProvider } from "@/components/ThemeToggle";
import { getBusiness } from "@/lib/business";

// Two faces, one app. The root layout carries only what BOTH need — fonts,
// the settings/theme providers, the html+body shell. The public website adds
// its own header, footer and SEO metadata in app/(site)/layout.tsx; the
// kiosk and staff pages stay chrome-free and bring their own nav.
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });

// A malformed domain in settings would otherwise throw here and take down
// every page, so it degrades to "no canonical base" instead.
function safeBase(): URL | undefined {
  try {
    return new URL(getBusiness().domain);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: safeBase(),
  // A sensible default for the staff and kiosk routes. The marketing pages
  // override this with their own titles and descriptions.
  title: {
    default: `${getBusiness().name} | Dog Daycare & Boarding in San Francisco`,
    template: `%s | ${getBusiness().name}`,
  },
  description:
    "Cage-free dog daycare and overnight boarding on Lombard Street in San Francisco. Supervised play, bathing, and dog walking from a team that treats your dog like pack.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Sign-in" },
};

export const viewport: Viewport = {
  themeColor: "#F8FAFC",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fredoka.variable} ${inter.variable}`}>
      <body className="font-body">
        {/* Hydrates the prices, catalogs, and branding every page reads. */}
        <SettingsProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
