"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { BookingStatusBadge } from "@/components/admin/StatusBadge";

export type AdminBooking = {
  id: string;
  name: string;
  email: string;
  status: string;
  startTime: string;
  endTime: string;
  bookerTimezone: string;
  meetLink: string | null;
  amountCents: number | null;
  paymentStatus: string | null;
  customAnswer: string | null;
  syncError: string | null;
  noShow: boolean;
  viaAgent: boolean;
  needsAttention: boolean;
  createdAt: string;
  meetingType: { name: string; color: string; slug: string };
};

export default function BookingsTable({ bookings, hostTimezone }: { bookings: AdminBooking[]; hostTimezone: string }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");

  const types = useMemo(() => [...new Set(bookings.map((b) => b.meetingType.slug))], [bookings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return bookings.filter((b) => {
      if (type !== "ALL" && b.meetingType.slug !== type) return false;
      if (!q) return true;
      return b.name.toLowerCase().includes(q) || b.email.toLowerCase().includes(q) || b.meetingType.name.toLowerCase().includes(q);
    });
  }, [bookings, query, type]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5">
        <input
          className="bk-input flex-1 min-w-[200px]"
          placeholder="Search name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="bk-input !w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="ALL">All meeting types</option>
          {types.map((slug) => (
            <option key={slug} value={slug}>
              /{slug}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && <p className="text-[var(--bk-muted)] text-sm">No bookings match.</p>}
        {filtered.map((b) => {
          const start = DateTime.fromISO(b.startTime, { zone: hostTimezone });
          return (
            <Link key={b.id} href={`/admin/bookings/${b.id}`} className="bk-card p-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 block">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: b.meetingType.color }} />
              <span className="font-medium tabular-nums">{start.toFormat("ccc LLL d, h:mm a")}</span>
              <span className="text-sm text-[var(--bk-muted)]">{b.meetingType.name}</span>
              <span className="text-sm">
                {b.name}
                {b.viaAgent && <span className="ml-1.5 text-xs text-[var(--bk-muted)]">· via AI agent</span>}
              </span>
              <span className="text-sm text-[var(--bk-muted)]">{b.email}</span>
              {b.amountCents ? (
                <span className="text-sm text-[var(--bk-muted)]">
                  ${(b.amountCents / 100).toFixed(0)} {b.paymentStatus ?? ""}
                </span>
              ) : null}
              {b.noShow && <span className="bk-badge bk-badge-warn">no-show</span>}
              <span className="ml-auto">
                <BookingStatusBadge status={b.needsAttention && b.status !== "FAILED_NEEDS_INTERVENTION" ? "FAILED_NEEDS_INTERVENTION" : b.status} />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
