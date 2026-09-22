"use client";

import { DateTime } from "luxon";
import type { InitialSlots } from "@/lib/ui/initial-slots";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "@/lib/ui/format";
import TimezoneCombobox from "./TimezoneCombobox";
import { useHourFormat, useTimezone } from "./useTimezone";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_MONTHS_AHEAD = 13; // sanity cap on forward paging; the real bound is empty slots

type MonthState = { slots: string[] } | { error: string; code?: string } | "loading" | undefined;

export type SlotsError = { message: string; code?: string };

type Props = {
  slug: string;
  durationMinutes: number;
  linkToken?: string | null;
  hostEmail: string;
  embed?: boolean;
  initialMonth?: string | null; // yyyy-MM
  initialDate?: string | null; // yyyy-MM-dd
  initialTz?: string | null;
  /** Server-rendered slots for the bookable window (skips the first network round trip). */
  initialSlots?: InitialSlots | null;
  /** Reschedule mode excludes the booking's own hold; slot count / grid look identical. */
  onSlotSelect: (iso: string) => void;
  onDateSelect?: (date: string) => void;
  onTimezoneChange?: (tz: string) => void;
  /** Fires once, the first time availability has loaded (or failed) — for bookkit:ready. */
  onReady?: () => void;
};

export default function CalendarAndSlots({
  slug,
  durationMinutes,
  linkToken,
  hostEmail,
  embed = false,
  initialMonth,
  initialDate,
  initialTz,
  initialSlots,
  onSlotSelect,
  onDateSelect,
  onTimezoneChange,
  onReady,
}: Props) {
  const { timezone, setTimezone, zones, ready } = useTimezone(initialTz);
  const { hour12, setHour12 } = useHourFormat();

  const [monthAnchor, setMonthAnchor] = useState<string>(() => initialMonth || DateTime.utc().toFormat("yyyy-MM"));
  const [selectedDay, setSelectedDay] = useState<string | null>(initialDate ?? null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [months, setMonths] = useState<Record<string, MonthState>>({});
  const [paused, setPaused] = useState<string | null>(null);

  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const inFlight = useRef(new Set<string>());
  const seeded = useRef(new Set<string>());

  useEffect(() => {
    if (initialTz) onTimezoneChange?.(initialTz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthStart = useMemo(
    () => DateTime.fromFormat(monthAnchor, "yyyy-MM", { zone: timezone }).startOf("month"),
    [monthAnchor, timezone]
  );
  // Stable across re-renders within the same day: DateTime.now() ticks the millisecond and would
  // otherwise hand fetchMonth a new object every render, retriggering its effect in a fetch loop.
  const todayKey = useMemo(() => DateTime.now().setZone(timezone).toFormat("yyyy-MM-dd"), [timezone]);
  const today = useMemo(() => DateTime.fromFormat(todayKey, "yyyy-MM-dd", { zone: timezone }), [todayKey, timezone]);

  const fetchMonth = useCallback(
    async (key: string) => {
      if (!ready || inFlight.current.has(key)) return;
      const anchor = DateTime.fromFormat(key, "yyyy-MM", { zone: timezone }).startOf("month");
      const from = anchor < today ? today : anchor;
      const to = anchor.endOf("month");
      if (to < today) {
        setMonths((m) => ({ ...m, [key]: { slots: [] } }));
        return;
      }
      // Serve from the server-rendered seed once per month, while it is fresh (60s).
      if (
        initialSlots &&
        !linkToken &&
        durationMinutes === initialSlots.duration &&
        !seeded.current.has(key) &&
        Date.now() - initialSlots.at < 60_000 &&
        to.toMillis() <= Date.parse(initialSlots.until)
      ) {
        seeded.current.add(key);
        const lo = from.startOf("day").toMillis();
        const hi = to.toMillis();
        const slots = initialSlots.slots.filter((s) => {
          const t = Date.parse(s);
          return t >= lo && t <= hi;
        });
        setMonths((m) => ({ ...m, [key]: { slots } }));
        return;
      }
      inFlight.current.add(key);
      setMonths((m) => (m[key] ? m : { ...m, [key]: "loading" }));
      try {
        const params = new URLSearchParams({
          slug,
          from: from.toFormat("yyyy-MM-dd"),
          to: to.toFormat("yyyy-MM-dd"),
          tz: timezone,
          duration: String(durationMinutes),
        });
        if (linkToken) params.set("link", linkToken);
        const res = await fetch(`/api/availability?${params}`, { cache: "no-store" });
        const data = await res.json();
        if (!data.ok) {
          setMonths((m) => ({ ...m, [key]: { error: data.error, code: data.code } }));
          return;
        }
        setPaused(data.paused ?? null);
        setMonths((m) => ({ ...m, [key]: { slots: data.slots as string[] } }));
      } catch {
        setMonths((m) => ({ ...m, [key]: { error: "Could not load availability. Check your connection and retry." } }));
      } finally {
        inFlight.current.delete(key);
      }
    },
    [ready, slug, timezone, durationMinutes, linkToken, today, initialSlots]
  );

  // Reset cached months when the query itself changes (tz/duration/link).
  useEffect(() => {
    setMonths({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, durationMinutes, linkToken, slug]);

  useEffect(() => {
    void fetchMonth(monthAnchor);
  }, [monthAnchor, fetchMonth]);

  // Prefetch next month in the background so paging forward feels instant.
  useEffect(() => {
    if (!ready) return;
    const next = monthStart.plus({ months: 1 }).toFormat("yyyy-MM");
    void fetchMonth(next);
  }, [ready, monthStart, fetchMonth]);

  const monthState = months[monthAnchor];
  const slots = monthState && typeof monthState === "object" && "slots" in monthState ? monthState.slots : null;
  const loading = monthState === "loading" || monthState === undefined;
  const loadError = monthState && typeof monthState === "object" && "error" in monthState ? monthState : null;

  const readyFired = useRef(false);
  useEffect(() => {
    if (!readyFired.current && monthState && monthState !== "loading") {
      readyFired.current = true;
      onReady?.();
    }
  }, [monthState, onReady]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const iso of slots ?? []) {
      const key = DateTime.fromISO(iso, { zone: timezone }).toFormat("yyyy-MM-dd");
      const list = map.get(key);
      if (list) list.push(iso);
      else map.set(key, [iso]);
    }
    return map;
  }, [slots, timezone]);

  // Auto-select the first open day so the picker is never empty on arrival.
  useEffect(() => {
    if (!slots || selectedDay) return;
    const first = Array.from(slotsByDay.keys()).sort()[0];
    if (first) {
      setSelectedDay(first);
      onDateSelect?.(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, slotsByDay]);

  const daysInGrid = useMemo(() => {
    const total = monthStart.daysInMonth ?? 30;
    const lead = monthStart.weekday % 7; // Luxon 1=Mon..7=Sun -> 0=Sun..6=Sat
    const cells: (DateTime | null)[] = Array(lead).fill(null);
    for (let d = 0; d < total; d++) cells.push(monthStart.plus({ days: d }));
    return cells;
  }, [monthStart]);

  const canGoBack = monthStart > today.startOf("month");
  const canGoForward = monthStart < today.startOf("month").plus({ months: MAX_MONTHS_AHEAD });

  function goMonth(delta: number) {
    const next = monthStart.plus({ months: delta }).toFormat("yyyy-MM");
    setMonthAnchor(next);
  }

  function pickDay(key: string) {
    setSelectedDay(key);
    setSelectedSlot(null);
    onDateSelect?.(key);
  }

  function pickSlot(iso: string) {
    setSelectedSlot(iso);
    onSlotSelect(iso);
  }

  function focusDay(key: string) {
    requestAnimationFrame(() => dayRefs.current.get(key)?.focus());
  }

  function onGridKeyDown(e: React.KeyboardEvent, day: DateTime) {
    const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key === "Home") {
      e.preventDefault();
      const key = monthStart.toFormat("yyyy-MM-dd");
      focusDay(key);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const key = monthStart.endOf("month").toFormat("yyyy-MM-dd");
      focusDay(key);
      return;
    }
    if (e.key === "PageUp") {
      e.preventDefault();
      goMonth(-1);
      return;
    }
    if (e.key === "PageDown") {
      e.preventDefault();
      goMonth(1);
      return;
    }
    const delta = deltas[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const target = day.plus({ days: delta });
    if (target.toFormat("yyyy-MM") !== monthAnchor) {
      setMonthAnchor(target.toFormat("yyyy-MM"));
    }
    focusDay(target.toFormat("yyyy-MM-dd"));
  }

  const daySlots = selectedDay ? slotsByDay.get(selectedDay) ?? [] : [];

  if (paused) {
    return (
      <div className="p-6 sm:p-8 text-center">
        <p className="text-sm text-[var(--bk-muted)] whitespace-pre-line">{paused}</p>
      </div>
    );
  }

  return (
    <div className="grid @xl:grid-cols-[1fr_220px]">
      {/* calendar */}
      <div className="p-5 sm:p-6 @xl:border-r border-[var(--bk-border)]">
        <div className="max-w-[460px] mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold" aria-live="polite">
              {monthStart.toFormat("LLLL yyyy")}
            </h2>
            <div className="flex gap-1">
              <button
                type="button"
                aria-label="Previous month"
                disabled={!canGoBack}
                onClick={() => goMonth(-1)}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[var(--bk-border)] disabled:opacity-30 hover:bg-[var(--bk-surface-2)]"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Next month"
                disabled={!canGoForward}
                onClick={() => goMonth(1)}
                className="w-8 h-8 grid place-items-center rounded-lg border border-[var(--bk-border)] disabled:opacity-30 hover:bg-[var(--bk-surface-2)]"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d, i) => (
              <div key={i} className="text-center text-[11px] font-medium text-[var(--bk-muted)] py-1">
                {d}
              </div>
            ))}
          </div>

          {loading && !slots ? (
            <div className="grid grid-cols-7 gap-1" aria-hidden="true">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="bk-skeleton aspect-square rounded-lg" />
              ))}
            </div>
          ) : (
            <div role="grid" aria-label="Available days" className="grid grid-cols-7 gap-1">
              {daysInGrid.map((day, i) => {
                if (!day) return <div key={`pad-${i}`} />;
                const key = day.toFormat("yyyy-MM-dd");
                const open = (slotsByDay.get(key)?.length ?? 0) > 0;
                const isSelected = key === selectedDay;
                const isTabStop = key === (selectedDay ?? monthStart.toFormat("yyyy-MM-dd"));
                return (
                  <button
                    key={key}
                    type="button"
                    role="gridcell"
                    ref={(el) => {
                      if (el) dayRefs.current.set(key, el);
                    }}
                    data-testid="bk-day"
                    data-date={key}
                    data-open={open ? "1" : "0"}
                    aria-disabled={!open}
                    aria-selected={isSelected}
                    aria-label={day.toFormat("cccc, LLLL d") + (open ? "" : " — no times available")}
                    tabIndex={isTabStop ? 0 : -1}
                    onClick={() => open && pickDay(key)}
                    onKeyDown={(e) => onGridKeyDown(e, day)}
                    className={`bk-day ${isSelected ? "bk-day-selected" : open ? "bk-day-open" : "bk-day-closed"}`}
                  >
                    {day.day}
                  </button>
                );
              })}
            </div>
          )}

          {!loading && loadError && (
            <div className="mt-4 text-sm">
              <p style={{ color: "var(--bk-danger)" }}>{loadError.error}</p>
              {loadError.code === "CALENDAR_DISCONNECTED" ? (
                <a className="underline text-[var(--bk-muted)]" href={`mailto:${hostEmail}`}>
                  Email {hostEmail} instead
                </a>
              ) : (
                <button type="button" onClick={() => void fetchMonth(monthAnchor)} className="underline text-[var(--bk-muted)]">
                  Try again
                </button>
              )}
            </div>
          )}

          {!loading && !loadError && slots && slots.length === 0 && (
            <p className="mt-4 text-sm text-[var(--bk-muted)]">Nothing open this month. Try the next one.</p>
          )}

          <div className="mt-5 pt-4 border-t border-[var(--bk-border)] space-y-3">
            <TimezoneCombobox
              value={timezone}
              zones={zones}
              onChange={(tz) => {
                setTimezone(tz);
                onTimezoneChange?.(tz);
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--bk-muted)]">Clock</span>
              <div role="radiogroup" aria-label="Time format" className="inline-flex rounded-lg border border-[var(--bk-border)] p-0.5 text-xs">
                {[
                  { v: true, label: "12h" },
                  { v: false, label: "24h" },
                ].map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    role="radio"
                    aria-checked={hour12 === opt.v}
                    onClick={() => setHour12(opt.v)}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      hour12 === opt.v ? "bg-[var(--bk-accent)] text-[var(--bk-accent-ink)]" : "text-[var(--bk-muted)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* slots */}
      <div className="p-5 sm:p-6 border-t @xl:border-t-0 border-[var(--bk-border)]">
        <p className="text-sm font-semibold mb-3">
          {selectedDay ? DateTime.fromFormat(selectedDay, "yyyy-MM-dd", { zone: timezone }).toFormat("cccc, LLL d") : "Pick a day"}
        </p>
        {loading && !slots ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bk-skeleton h-[42px] rounded-lg" />
            ))}
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label="Available times"
            className={`bk-scroll flex flex-col gap-2 ${embed ? "" : "@xl:max-h-[330px] @xl:overflow-y-auto @xl:pr-1"}`}
          >
            {daySlots.map((iso) => {
              const t = DateTime.fromISO(iso, { zone: timezone });
              return (
                <button
                  key={iso}
                  type="button"
                  role="radio"
                  aria-checked={selectedSlot === iso}
                  data-testid="bk-slot"
                  data-slot={iso}
                  onClick={() => pickSlot(iso)}
                  className={`bk-slot ${selectedSlot === iso ? "bk-slot-active" : ""}`}
                >
                  {formatTime(t, hour12)}
                </button>
              );
            })}
            {!daySlots.length && !loading && (
              <p className="text-sm text-[var(--bk-muted)]">{selectedDay ? "No times left on this day." : "Select a highlighted day."}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
