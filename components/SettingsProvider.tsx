"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { AppSettings, DEFAULT_SETTINGS, getSettings, loadSettings } from "@/lib/settings";

const SettingsContext = createContext<{ settings: AppSettings; refresh: () => Promise<void> }>({
  settings: DEFAULT_SETTINGS,
  refresh: async () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

// Loads the settings row once at startup and hydrates the module cache the
// pricing getters read from. Children render immediately against the
// shipped defaults rather than blocking on the network — the kiosk should
// come up even if Supabase is slow — and re-render once the real values
// land.
export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(getSettings());

  async function refresh() {
    setSettings(await loadSettings());
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, refresh }}>{children}</SettingsContext.Provider>
  );
}
