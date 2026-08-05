import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BookKit — your own booking page",
  description:
    "Self-hosted scheduling with Google Calendar, Google Meet links and paid bookings via Stripe.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
