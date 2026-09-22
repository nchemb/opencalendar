import { redirect } from "next/navigation";

// Renamed to /admin/event-types in v2. Old path kept working via redirect.
export default function MeetingTypesRedirect() {
  redirect("/admin/event-types");
}
