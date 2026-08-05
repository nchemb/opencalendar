"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useEffect, useMemo, useRef, useState } from "react";

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

type Props = {
  publishableKey: string;
  clientSecret: string;
  bookingId: string;
  expiresAt: string;
  accentColor: string;
  amountLabel: string;
  onPaid: (bookingId: string) => void;
  onExpired: () => void;
};

function CountdownNote({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const [left, setLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) {
        clearInterval(t);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpired]);

  if (left <= 0) return null;
  const min = Math.floor(left / 60_000);
  const sec = Math.floor((left % 60_000) / 1000);
  return (
    <p className="text-xs text-[var(--bk-muted)] text-center">
      This time is held for you for {min}:{String(sec).padStart(2, "0")}
    </p>
  );
}

function CardForm({
  bookingId,
  amountLabel,
  expiresAt,
  onPaid,
  onExpired,
}: Omit<Props, "publishableKey" | "clientSecret" | "accentColor">) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    setError(null);

    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}/success?booking=${bookingId}`,
      },
    });

    if (result.error) {
      setError(result.error.message ?? "Payment failed. Try another card.");
      setSubmitting(false);
      return;
    }

    const status = result.paymentIntent?.status;
    if (status === "succeeded" || status === "processing") {
      onPaid(bookingId);
      return;
    }

    setError("Payment did not complete. Please try again.");
    setSubmitting(false);
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement onReady={() => setReady(true)} options={{ layout: "tabs" }} />

      {error && (
        <p className="text-sm" style={{ color: "var(--bk-danger)" }}>{error}</p>
      )}

      <button type="submit" className="bk-btn bk-btn-primary w-full" disabled={!stripe || !ready || submitting}>
        {submitting ? (
          <>
            <svg className="bk-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Processing…
          </>
        ) : (
          `Pay ${amountLabel} and book`
        )}
      </button>

      <CountdownNote expiresAt={expiresAt} onExpired={onExpired} />
      <p className="text-xs text-[var(--bk-muted)] text-center">Payments secured by Stripe.</p>
    </form>
  );
}

export default function PaymentStep({
  publishableKey,
  clientSecret,
  accentColor,
  ...rest
}: Props) {
  const stripe = useMemo(() => getStripe(publishableKey), [publishableKey]);
  // Element appearance follows the page theme + meeting-type accent.
  const isLight = useRef(
    typeof document !== "undefined" &&
      document.querySelector('[data-theme="light"]') !== null
  );

  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret,
        appearance: {
          theme: isLight.current ? "stripe" : "night",
          variables: {
            colorPrimary: accentColor,
            borderRadius: "10px",
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
          },
        },
      }}
    >
      <CardForm {...rest} />
    </Elements>
  );
}
