import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { brand: string } }) {
  const brand = await prisma.brand.findUnique({
    where: { slug: params.brand },
    include: { host: true },
  });

  const accent = brand?.accentColor || "#FF6A00";
  const avatar = brand?.logoUrl || brand?.host.avatarUrl;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0b0c",
          color: "#f2f2f4",
          fontFamily: "sans-serif",
        }}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} width={120} height={120} style={{ borderRadius: 32, marginBottom: 36 }} alt="" />
        ) : (
          <div style={{ width: 120, height: 120, borderRadius: 32, background: accent, marginBottom: 36, display: "flex" }} />
        )}
        <span style={{ fontSize: 64, fontWeight: 600 }}>{brand?.name || "Not found"}</span>
        {brand?.tagline && <span style={{ fontSize: 28, color: "#9a9aa3", marginTop: 16 }}>{brand.tagline}</span>}
      </div>
    ),
    { ...size }
  );
}
