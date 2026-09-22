"use client";
/**
 * Copy this file straight into your React/Next.js app (e.g. components/BookKit.tsx).
 * No npm package — it's a thin, typed wrapper around embed.js. Full event and
 * param contract: ../../docs/EMBED-PROTOCOL.md. SSR-safe: every DOM/window touch
 * is inside useEffect.
 *
 *   <BookKitButton baseUrl="https://book.you.com" slug="strategy-call">Book a call</BookKitButton>
 *   <BookKitInline baseUrl="https://book.you.com" slug="strategy-call" />
 *   useBookKitEvent("booked", (detail) => track("booking", detail));
 */
import { useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";

export type BookKitPrefill = {
  name?: string;
  email?: string;
  answers?: Record<string, string>;
  guests?: string[];
};

export type BookKitOpenOptions = {
  prefill?: BookKitPrefill;
  utm?: Record<string, string>;
  duration?: number;
  theme?: "light" | "dark" | "auto";
  accent?: string;
  hideDetails?: boolean;
  tz?: string;
};

export type BookKitBadgeOptions = BookKitOpenOptions & {
  slug: string;
  text?: string;
  color?: string;
  textColor?: string;
  position?: "bottom-right" | "bottom-left";
};

type BookKitGlobal = {
  __bookkitEmbedV2?: boolean;
  origin: string;
  open: (slug: string, opts?: BookKitOpenOptions) => { close: () => void; embedId: string };
  close: () => void;
  inline: (el: Element | string, slug: string, opts?: BookKitOpenOptions) => HTMLIFrameElement | null;
  badge: (opts: BookKitBadgeOptions) => HTMLButtonElement;
  on: (type: string, handler: (detail: unknown) => void) => () => void;
  mountAll: (root?: ParentNode) => void;
};

declare global {
  interface Window {
    BookKit?: BookKitGlobal;
  }
}

const loadPromises = new Map<string, Promise<void>>();

/** Loads embed.js from `baseUrl` at most once per baseUrl, even across many components on the page. */
function loadEmbedScript(baseUrl: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const normalized = baseUrl.replace(/\/$/, "");
  if (window.BookKit?.__bookkitEmbedV2) return Promise.resolve();
  const existingPromise = loadPromises.get(normalized);
  if (existingPromise) return existingPromise;

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-bookkit-base="${normalized}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load BookKit embed.js")));
      return;
    }
    const script = document.createElement("script");
    script.src = `${normalized}/embed.js`;
    script.defer = true;
    script.dataset.bookkitBase = normalized;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Failed to load BookKit embed.js")));
    document.head.appendChild(script);
  });
  loadPromises.set(normalized, promise);
  return promise;
}

export type BookKitButtonProps = {
  /** Your BookKit instance's URL, e.g. "https://book.you.com". */
  baseUrl: string;
  slug: string;
  options?: BookKitOpenOptions;
  className?: string;
  children?: ReactNode;
  /** Render as <a href="baseUrl/slug"> (works with no JS) or <button>. Default "a". */
  as?: "a" | "button";
};

/** Opens the BookKit popup on click. Renders a real link/button immediately; embed.js loads in the background. */
export function BookKitButton({ baseUrl, slug, options, className, children, as = "a" }: BookKitButtonProps) {
  useEffect(() => {
    void loadEmbedScript(baseUrl);
  }, [baseUrl]);

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    loadEmbedScript(baseUrl).then(() => window.BookKit?.open(slug, options));
  };

  const label = children ?? "Book a meeting";
  if (as === "button") {
    return (
      <button type="button" className={className} onClick={handleClick}>
        {label}
      </button>
    );
  }
  return (
    <a href={`${baseUrl.replace(/\/$/, "")}/${slug}`} className={className} onClick={handleClick}>
      {label}
    </a>
  );
}

export type BookKitInlineProps = {
  baseUrl: string;
  slug: string;
  options?: BookKitOpenOptions;
  className?: string;
  style?: CSSProperties;
};

/** An auto-resizing inline booking widget. */
export function BookKitInline({ baseUrl, slug, options, className, style }: BookKitInlineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;
    loadEmbedScript(baseUrl).then(() => {
      if (!cancelled && ref.current) window.BookKit?.inline(ref.current, slug, optionsRef.current);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options intentionally re-read via ref, not a re-mount trigger
  }, [baseUrl, slug]);

  return <div ref={ref} className={className} style={style} />;
}

/**
 * Subscribes to a BookKit event ("ready" | "date_selected" | "slot_selected" |
 * "payment_started" | "booked" | "close" | "height") for the component's lifetime.
 * Pass `baseUrl` if embed.js might not be loaded yet by anything else on the page.
 */
export function useBookKitEvent(type: string, handler: (detail: unknown) => void, baseUrl?: string) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let off: (() => void) | undefined;
    let cancelled = false;
    const attach = () => {
      if (cancelled || !window.BookKit) return;
      off = window.BookKit.on(type, (detail) => handlerRef.current(detail));
    };
    if (baseUrl) loadEmbedScript(baseUrl).then(attach);
    else attach();
    return () => {
      cancelled = true;
      off?.();
    };
  }, [type, baseUrl]);
}
