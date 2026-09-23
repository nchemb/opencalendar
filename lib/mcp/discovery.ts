/** Agent discovery documents: /llms.txt and /.well-known/mcp.json, built from agent-bookable types. */
import { appUrl } from "../env";
import { agentView, listAgentBookable, PUBLIC_MCP_PATH } from "./public-tools";

const hostLabel = (h: { displayName: string | null }) => h.displayName || "this host";

export async function llmsTxt(): Promise<string> {
  const { host, types } = await listAgentBookable();
  const base = appUrl();
  const mcp = `${base}${PUBLIC_MCP_PATH}`;
  const who = hostLabel(host);
  const lines = [
    `# Book a meeting with ${who}`,
    "",
    `> ${who} takes bookings here through OpenCalendar. AI agents can check open times and book through a public MCP server, no API key needed.`,
    "",
    "## How an agent books",
    "",
    `- MCP server (Streamable HTTP, no auth): ${mcp}`,
    "- Tools: `list_event_types` → `find_available_times` → `book_meeting` (the invitee's real name and email).",
    "- Free meetings are booked directly; the invitee gets the confirmation email and calendar invite.",
    "- Paid meetings are not booked by the agent: `book_meeting` returns a checkout URL with the time preselected. Give it to the person to pay.",
    `- Descriptor: ${base}/.well-known/mcp.json`,
    "",
    "## Meetings",
    "",
  ];
  if (!types.length) lines.push("No meetings are open to agent booking right now.");
  for (const mt of types) {
    const v = agentView(mt, host);
    const price = v.durations
      .map((d) => `${d.minutes} min, ${d.priceCents ? `$${(d.priceCents / 100).toFixed(2)} ${v.currency.toUpperCase()} (checkout link)` : "free"}`)
      .join(" / ");
    lines.push(`- [${v.name}](${v.bookingUrl}): slug \`${v.slug}\`, ${price}, host timezone ${v.timezone}.${v.description ? ` ${v.description.replace(/\s+/g, " ").trim()}` : ""}`);
  }
  return lines.join("\n") + "\n";
}

export async function mcpDescriptor() {
  const { host, types } = await listAgentBookable();
  const url = `${appUrl()}${PUBLIC_MCP_PATH}`;
  return {
    name: `Book ${hostLabel(host)}`,
    description: "Check open times and book meetings. Free meetings book directly; paid ones return a checkout link for a human.",
    transport: "streamable-http",
    url,
    authentication: "none",
    tools: ["list_event_types", "find_available_times", "book_meeting"],
    eventTypes: types.map((mt) => mt.slug),
    documentation: `${appUrl()}/llms.txt`,
    mcpServers: { opencalendar: { type: "http", url } },
  };
}
