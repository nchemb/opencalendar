"use client";

import { useRef } from "react";
import { locationLabel, type LocationOption, type PublicMeetingType } from "@/lib/types";

export type FormState = {
  name: string;
  email: string;
  answers: Record<string, string | string[]>;
  guests: string;
  location: LocationOption;
  invPhone: string;
};

export type DetailsPayload = {
  name: string;
  email: string;
  answers: Record<string, string | string[]>;
  guests: string;
  location: LocationOption | null;
  company: string;
  elapsedMs: number;
};

type Props = {
  meetingType: PublicMeetingType;
  state: FormState;
  onChange: (patch: Partial<FormState>) => void;
  submitLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (payload: DetailsPayload) => void;
  onBack: () => void;
};

/**
 * Controlled by the parent (name/email/answers/guests/location) so a 409 slot-taken
 * error can send the invitee back to the calendar without losing what they typed.
 */
export default function DetailsForm({ meetingType: mt, state, onChange, submitLabel, submitting, error, onSubmit, onBack }: Props) {
  const company = useRef("");
  const mountedAt = useRef(Date.now());

  function setAnswer(id: string, value: string | string[]) {
    onChange({ answers: { ...state.answers, [id]: value } });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const location: LocationOption | null =
      state.location.kind === "phone_invitee" ? { kind: "phone_invitee", value: state.invPhone } : state.location;
    onSubmit({
      name: state.name,
      email: state.email,
      answers: state.answers,
      guests: state.guests,
      location,
      company: company.current,
      elapsedMs: Date.now() - mountedAt.current,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <div>
        <label className="bk-label" htmlFor="bk-name">
          Name
        </label>
        <input
          id="bk-name"
          className="bk-input"
          value={state.name}
          onChange={(e) => onChange({ name: e.target.value })}
          required
          maxLength={120}
          autoComplete="name"
        />
      </div>
      <div>
        <label className="bk-label" htmlFor="bk-email">
          Email
        </label>
        <input
          id="bk-email"
          className="bk-input"
          type="email"
          value={state.email}
          onChange={(e) => onChange({ email: e.target.value })}
          required
          maxLength={254}
          autoComplete="email"
        />
      </div>

      {mt.locations.length > 1 && (
        <fieldset>
          <legend className="bk-label">Location</legend>
          <div className="space-y-1.5">
            {mt.locations.map((l, i) => (
              <label key={i} className="bk-choice">
                <input
                  type="radio"
                  name="bk-location"
                  checked={state.location.kind === l.kind && state.location.value === l.value}
                  onChange={() => onChange({ location: l })}
                />
                {locationLabel(l)}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {state.location.kind === "phone_invitee" && (
        <div>
          <label className="bk-label" htmlFor="bk-inv-phone">
            Phone number to call you on
          </label>
          <input
            id="bk-inv-phone"
            className="bk-input"
            type="tel"
            value={state.invPhone}
            onChange={(e) => onChange({ invPhone: e.target.value })}
            required
            maxLength={30}
            autoComplete="tel"
          />
        </div>
      )}

      {mt.questions.map((q) => (
        <div key={q.id}>
          <label className="bk-label" htmlFor={`bk-q-${q.id}`}>
            {q.label}
            {!q.required && <span className="opacity-60"> (optional)</span>}
          </label>

          {q.type === "short_text" && (
            <input
              id={`bk-q-${q.id}`}
              className="bk-input"
              value={(state.answers[q.id] as string) ?? ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              required={q.required}
              maxLength={500}
            />
          )}
          {q.type === "long_text" && (
            <textarea
              id={`bk-q-${q.id}`}
              className="bk-input resize-y min-h-[72px]"
              value={(state.answers[q.id] as string) ?? ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              required={q.required}
              maxLength={4000}
            />
          )}
          {q.type === "phone" && (
            <input
              id={`bk-q-${q.id}`}
              className="bk-input"
              type="tel"
              value={(state.answers[q.id] as string) ?? ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              required={q.required}
              maxLength={30}
            />
          )}
          {q.type === "dropdown" && (
            <select
              id={`bk-q-${q.id}`}
              className="bk-input"
              value={(state.answers[q.id] as string) ?? ""}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              required={q.required}
            >
              <option value="" disabled>
                Choose one
              </option>
              {q.options?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {q.type === "single_choice" && (
            <div className="space-y-1.5">
              {q.options?.map((o) => (
                <label key={o} className="bk-choice">
                  <input
                    type="radio"
                    name={`bk-q-${q.id}`}
                    required={q.required}
                    checked={state.answers[q.id] === o}
                    onChange={() => setAnswer(q.id, o)}
                  />
                  {o}
                </label>
              ))}
            </div>
          )}
          {q.type === "multi_choice" && (
            <div className="space-y-1.5">
              {q.options?.map((o) => {
                const picked = Array.isArray(state.answers[q.id]) ? (state.answers[q.id] as string[]) : [];
                return (
                  <label key={o} className="bk-choice">
                    <input
                      type="checkbox"
                      checked={picked.includes(o)}
                      onChange={(e) => setAnswer(q.id, e.target.checked ? [...picked, o] : picked.filter((v) => v !== o))}
                    />
                    {o}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {mt.allowGuests && (
        <div>
          <label className="bk-label" htmlFor="bk-guests">
            Guests <span className="opacity-60">(optional, up to {mt.maxGuests})</span>
          </label>
          <input
            id="bk-guests"
            className="bk-input"
            placeholder="guest@email.com, another@email.com"
            value={state.guests}
            onChange={(e) => onChange({ guests: e.target.value })}
          />
        </div>
      )}

      {mt.policyText && <p className="text-xs text-[var(--bk-muted)]">{mt.policyText}</p>}

      <input
        type="text"
        name="company"
        onChange={(e) => (company.current = e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
      />

      {error && (
        <p className="text-sm" style={{ color: "var(--bk-danger)" }}>
          {error}
        </p>
      )}

      <div className="flex gap-2.5">
        <button type="button" onClick={onBack} className="bk-btn bk-btn-ghost">
          Back
        </button>
        <button type="submit" className="bk-btn bk-btn-primary flex-1" disabled={submitting}>
          {submitting ? (
            <>
              <svg className="bk-spin" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              One moment…
            </>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  );
}
