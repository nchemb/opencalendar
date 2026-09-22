import { createElement, Fragment, type ReactNode } from "react";

/** **bold** and [text](url) inside a line of plain text. No HTML is ever parsed. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(createElement("strong", { key: `${keyPrefix}-${i++}` }, m[1]));
    } else {
      out.push(
        createElement(
          "a",
          { key: `${keyPrefix}-${i++}`, href: m[3], target: "_blank", rel: "noreferrer", className: "underline" },
          m[2]
        )
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * Renders paragraphs, "- " bullet lists, **bold** and [links](url) — the only markup
 * a meeting-type description can carry (D1). Anything else is plain text.
 */
export function renderDescription(text: string): ReactNode {
  const blocks = text.trim().split(/\n{2,}/);
  return createElement(
    Fragment,
    null,
    blocks.map((block, bi) => {
      const lines = block.split("\n").filter((l) => l.trim());
      const isList = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l.trim()));
      if (isList) {
        return createElement(
          "ul",
          { key: bi, className: "list-disc pl-5 space-y-1" },
          lines.map((l, li) => createElement("li", { key: li }, inline(l.trim().replace(/^[-*]\s+/, ""), `${bi}-${li}`)))
        );
      }
      return createElement("p", { key: bi }, inline(lines.join(" "), `${bi}`));
    })
  );
}

/** Flattens the same markup to plain text — for a one-line card preview (brand page, list rows). */
export function plainTextPreview(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[(.+?)\]\(https?:\/\/[^\s)]+\)/g, "$1")
    .trim();
}
