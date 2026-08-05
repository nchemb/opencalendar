"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "bookkit.timezone";

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const FALLBACK_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Athens",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

export function useTimezone() {
  // Start on the server-stable default, then swap after mount to avoid hydration drift.
  const [timezone, setTimezoneState] = useState<string>("UTC");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let initial = detectTimezone();
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) initial = stored;
    } catch {
      /* private mode */
    }
    setTimezoneState(initial);
    setReady(true);
  }, []);

  function setTimezone(tz: string) {
    setTimezoneState(tz);
    try {
      window.localStorage.setItem(STORAGE_KEY, tz);
    } catch {
      /* ignore */
    }
  }

  const zones = useMemo(() => {
    let list: string[] = [];
    try {
      const supported = (
        Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
      ).supportedValuesOf;
      if (typeof supported === "function") list = supported("timeZone");
    } catch {
      /* older browser */
    }
    if (!list.length) list = FALLBACK_ZONES;
    const detected = detectTimezone();
    const merged = Array.from(new Set([detected, timezone, ...list])).filter(Boolean);
    return merged;
  }, [timezone]);

  return { timezone, setTimezone, zones, ready };
}
