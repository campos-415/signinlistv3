import type { Metadata, Viewport } from "next";
import { Fredoka, Inter } from "next/font/google";
import "./globals.css";
import SettingsProvider from "@/components/SettingsProvider";
import { ThemeProvider } from "@/components/ThemeToggle";

const fredoka = Fredoka({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body" });

export const metadata: Metadata = {
  // Placeholder only — SettingsProvider replaces this at runtime with the
  // configured business name, so a new deployment needs no code change.
  title: "Daycare sign-in",
  description: "Lobby sign-in kiosk",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Sign-in" },
};

export const viewport: Viewport = {
  themeColor: "#F8FAFC",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fredoka.variable} ${inter.variable}`}>
      <body>
        {/* Hydrates the prices, catalogs, and branding every page reads. */}
        <SettingsProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </SettingsProvider>
      </body>
    </html>
  );
}
