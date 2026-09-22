import { ImageResponse } from "next/og";
import { findActiveMeetingType, toPublic } from "@/lib/meeting-types";
import { money } from "@/lib/ui/format";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { slug: string } }) {
  const found = await findActiveMeetingType(params.slug);
  const mt = found ? toPublic(found.meetingType, found.host) : null;

  const accent = mt?.color || "#FF6A00";
  const brandName = mt?.brand?.name || mt?.hostName || "BookKit";
  const avatar = mt?.brand?.logoUrl || mt?.hostAvatarUrl;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0b0c",
          color: "#f2f2f4",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} width={48} height={48} style={{ borderRadius: 12 }} alt="" />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: 12, background: accent, display: "flex" }} />
          )}
          <span style={{ fontSize: 28, color: "#9a9aa3" }}>{brandName}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 64, fontWeight: 600, lineHeight: 1.1 }}>{mt?.name || "Not found"}</span>
          <div style={{ display: "flex", gap: 16, marginTop: 28, alignItems: "center" }}>
            {mt && (
              <span
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  color: "#0b0b0c",
                  background: accent,
                  padding: "8px 20px",
                  borderRadius: 999,
                  display: "flex",
                }}
              >
                {mt.durationMinutes} min
              </span>
            )}
            {mt?.priceCents ? (
              <span style={{ fontSize: 24, color: "#9a9aa3", display: "flex" }}>{money(mt.priceCents, mt.currency)}</span>
            ) : (
              mt && <span style={{ fontSize: 24, color: "#9a9aa3", display: "flex" }}>Free</span>
            )}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
