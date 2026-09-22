"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  value: string;
  zones: string[];
  onChange: (tz: string) => void;
  id?: string;
};

function label(tz: string) {
  return tz.replace(/_/g, " ").replace(/\//g, " / ");
}

/** Searchable timezone list (D2). A plain <select> can't be filtered, and IANA has ~400 zones. */
export default function TimezoneCombobox({ value, zones, onChange, id = "bk-tz" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? zones.filter((z) => label(z).toLowerCase().includes(q)) : zones;
    return list.slice(0, 60);
  }, [zones, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function choose(tz: string) {
    onChange(tz);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[active]) choose(filtered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="bk-label" htmlFor={id}>
        Timezone
      </label>
      <input
        id={id}
        className="bk-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        value={open ? query : label(value)}
        placeholder={label(value)}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          className="bk-scroll absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-[var(--bk-border)] bg-[var(--bk-surface)] shadow-lg py-1"
        >
          {filtered.length === 0 && <li className="px-3 py-2 text-sm text-[var(--bk-muted)]">No match</li>}
          {filtered.map((z, i) => (
            <li key={z} role="option" aria-selected={z === value}>
              <button
                type="button"
                onClick={() => choose(z)}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-3 py-1.5 text-sm ${
                  i === active ? "bg-[var(--bk-surface-2)]" : ""
                } ${z === value ? "font-semibold" : ""}`}
              >
                {label(z)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
