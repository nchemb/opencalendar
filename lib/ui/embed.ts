"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The iframe <-> parent contract (docs/EMBED-PROTOCOL.md). Only used on /embed/[slug];
 * the full page never has a window.parent to talk to.
 */
export type EmbedCtx = { embedId: string | null; slug: string };

function post(msg: Record<string, unknown>) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage(msg, "*");
  } catch {
    /* cross-origin parent that refuses messages */
  }
}

/** New `bookkit:*` message, plus the old v1 dotted name when one is given. */
export function emitEmbed(
  ctx: EmbedCtx,
  type: string,
  detail: Record<string, unknown> = {},
  v1Name?: string,
  v1Detail?: Record<string, unknown>
) {
  post({ type: `bookkit:${type}`, embedId: ctx.embedId, slug: ctx.slug, ...detail });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(`bookkit:${type}`, { detail: { ...detail, slug: ctx.slug } }));
  }
  if (v1Name) post({ type: v1Name, ...(v1Detail ?? detail) });
}

/**
 * Sizes the iframe to its content (bookkit:height / v1 bookkit.resize) and exposes
 * UTMs the parent page forwards in (bookkit:parent_utm), trusted only for that.
 */
export function useEmbedResize<T extends HTMLElement>(ctx: EmbedCtx, ref: React.RefObject<T>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined" || window.parent === window) return;
    const send = () => {
      const height = Math.ceil(el.getBoundingClientRect().height) + 8;
      emitEmbed(ctx, "height", { height }, "bookkit.resize", { height });
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}

export function useParentUtm(): Record<string, string> {
  const [utm, setUtm] = useState<Record<string, string>>({});
  const trustedOrigin = useRef<string | null>(null);
  useEffect(() => {
    if (typeof document !== "undefined" && document.referrer) {
      try {
        trustedOrigin.current = new URL(document.referrer).origin;
      } catch {
        /* no referrer to trust */
      }
    }
    function onMessage(e: MessageEvent) {
      if (trustedOrigin.current && e.origin !== trustedOrigin.current) return;
      const data = e.data as { type?: string; utm?: Record<string, string> };
      if (data?.type === "bookkit:parent_utm" && data.utm && typeof data.utm === "object") {
        setUtm((prev) => ({ ...prev, ...data.utm }));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return utm;
}
