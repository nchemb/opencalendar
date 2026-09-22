import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** v1 cancel links (old emails) still point here; the manage page now owns cancel + reschedule. */
export default function CancelRedirect({ params }: { params: { token: string } }) {
  redirect(`/booking/${params.token}?action=cancel`);
}
