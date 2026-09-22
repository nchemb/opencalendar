"use client";

import { useEffect, useMemo, useState } from "react";
import { detectHour12 } from "@/lib/ui/format";

const TZ_KEY = "bookkit.timezone";
const HOUR_KEY = "bookkit.hour12";

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

/** `initialTz` is a `?tz=` URL override (embed protocol); it wins over storage/detection once. */
export function useTimezone(initialTz?: string | null) {
  const [timezone, setTimezoneState] = useState<string>("UTC");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let initial = initialTz || detectTimezone();
    if (!initialTz) {
      try {
        const stored = window.localStorage.getItem(TZ_KEY);
        if (stored) initial = stored;
      } catch {
        /* private mode */
      }
    }
    setTimezoneState(initial);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTimezone(tz: string) {
    setTimezoneState(tz);
    try {
      window.localStorage.setItem(TZ_KEY, tz);
    } catch {
      /* ignore */
    }
  }

  const zones = useMemo(() => {
    let list: string[] = [];
    try {
      const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
      if (typeof supported === "function") list = supported("timeZone");
    } catch {
      /* older browser */
    }
    if (!list.length) list = FALLBACK_ZONES;
    const detected = detectTimezone();
    return Array.from(new Set([detected, timezone, ...list])).filter(Boolean);
  }, [timezone]);

  return { timezone, setTimezone, zones, ready };
}

/** 12h/24h toggle, defaulted from the browser locale (D2) and remembered like the timezone. */
export function useHourFormat() {
  const [hour12, setHour12State] = useState(true);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HOUR_KEY);
      setHour12State(stored ? stored === "12" : detectHour12());
    } catch {
      setHour12State(detectHour12());
    }
  }, []);
  function setHour12(v: boolean) {
    setHour12State(v);
    try {
      window.localStorage.setItem(HOUR_KEY, v ? "12" : "24");
    } catch {
      /* ignore */
    }
  }
  return { hour12, setHour12 };
}
