# Calendly Feature Inventory (2026)

Research for bookkit (open-source, self-hosted Calendly replacement — Next.js 14 + Prisma/Postgres + Google Calendar + Stripe + Resend). Target users: solo consultant/creator running one paid 1:1 link + one free intake link, plus OSS adopters wanting the same for their own bios/sites. Tier tags reflect calendly.com's current plan names: **Free / Standard / Teams / Enterprise**. Untagged = tier not explicitly stated in the source.

Note on sourcing: Calendly's help center moved from `help.calendly.com/hc/en-us/articles/...` (Zendesk) to `calendly.com/help/...` sometime before Sep 2026 — old deep links now redirect to the generic help homepage. All `[source]` links below use the current, live URL structure, verified by direct scrape this pass, except the Webhooks/API sections, whose primary source (developer.calendly.com) is a JS-rendered Stoplight app that would not return content to a scraper — those entries are marked accordingly.

---

## Pricing Tiers (calendly.com/pricing)

- **Free** — always free — 1 event type, 1 calendar connection, one-on-one scheduling only, customizable booking page, mobile app + browser extension. "Meeting polls and one-off meetings" and "Control your meeting availability" are listed as included from Free up. [source: https://calendly.com/pricing]
- **Standard** — $10/seat/mo (billed yearly, ~17% savings vs. monthly) — unlimited event types, 6 calendar connections, unlimited group/collective/multi-person event types, automations & reminders, Stripe/PayPal payments (+ payment links, prepaid meeting packages, invoices, coupons/custom terms), Contacts CRM, HubSpot/Mailchimp/Zapier integrations, custom branding + remove-Calendly-branding, custom confirmation-page redirects, 24/7 chat support. Notetaker/Callie AI add-ons available but not included. [source: https://calendly.com/pricing]
- **Teams** — $16/seat/mo (billed yearly, ~20% savings), marked "Popular" — round-robin meeting distribution, qualify/route/schedule leads (Routing Forms incl. HubSpot/Pardot/Marketo form data + assignment-based routing), centrally-managed/admin-assigned event types, Marketo/Salesforce CRM sync, org-wide admin Zoom connect, team scheduling analytics, groups + delegated admins, SSO available only as a paid add-on at this tier, phone support. [source: https://calendly.com/pricing]
- **Enterprise** — starts $15k/yr, minimum 50 seats, sales-only (Talk to sales) — Salesforce-lookup routing, MS Dynamics 365 + Power Automate, SSO **and** SAML included, SCIM, automated group provisioning, domain control, audit-log compliance, **Data Deletion API**, security/legal reviews, dedicated onboarding + account support. [source: https://calendly.com/pricing]
- **Add-ons (cut across plans):** Notetaker (AI meeting recorder/transcriber for Zoom/Meet/Teams, generates recaps + drafted follow-ups) — "Standard Plus"/"Teams Plus" paid tier, "Inquire" on Enterprise. Callie (beta AI email-scheduling assistant, cc `callie@calendly.com` or chat in-app) — same add-on structure. [source: https://calendly.com/pricing]
- Calendar-connection caps by tier: Free = 1, Standard/Teams = 6, Enterprise = unlimited. [source: https://calendly.com/pricing]

---

## Event Type Settings

- Four event type formats: **One-on-one** (1 host/1 invitee, Free+), **Group** (1 host/many invitees, Standard+), **Collective** (multiple hosts + 1 invitee, all must be free, Standard+), **Round Robin** (rotates among team, Teams+). [source: https://calendly.com/help/group-event-type-overview, https://calendly.com/pricing]
- Duration: one fixed duration per event type by default; a separate "multiple durations" feature lets invitees pick from several (e.g. 15/30/60 min) on one booking page. [source: https://calendly.com/help/how-to-set-up-multiple-durations-for-an-event-type]
- Locations: in-person (address + notes), phone call (invitee's number captured, or host provides their own post-booking), video (Zoom/Google Meet/MS Teams auto-linked once integration connected), custom/free-text location, or "invitee to specify" (adds a location question to the booking form). Multiple location options can be offered on one-on-one event types for the invitee to pick between. [All plans] [source: https://calendly.com/help/how-to-set-the-location-for-your-event-type, https://calendly.com/help/video-conferencing]
- Date range / scheduling window: rolling N days (e.g. 60 days), fixed calendar date range, or indefinite — set per event type under Availability → Date-range. [All plans] [source: https://calendly.com/help/how-to-fine-tune-your-availability-settings]
- Minimum scheduling notice: e.g. "4 hours," blocks bookings starting sooner than the set window, same Date-range control. [All plans] [source: same]
- Buffer time before/after events, set independently, prevents back-to-back bookings. [All plans] [source: https://calendly.com/help/how-to-use-buffers]
- Booking limits: cap number of bookings per day/week/month, per event type or across all events/hosts. [All plans] [source: https://calendly.com/help/how-to-set-meeting-limits]
- Start-time increments: controls slot granularity on the booking page independent of meeting duration (e.g. 15-min slots for a 30-min meeting). [All plans] [source: https://calendly.com/help/how-to-fine-tune-your-availability-settings]
- Free/busy priority rules: lets a specific event type be booked over certain existing calendar events instead of treating them as fully blocking. [source: https://calendly.com/help/free-busy-rules-overview]
- Secret event types: "Make secret" hides an event from the public scheduling page; still bookable via direct link (desktop-only toggle). [All plans] [source: https://calendly.com/help/how-to-fine-tune-your-availability-settings]
- One-off meetings: ad hoc meeting with custom duration/location/hosts for a single high-priority booking, generated outside the normal event-type flow. [source: https://calendly.com/help/how-to-create-a-one-off-meeting]
- Single-use links: link auto-expires/deactivates once booked, prevents re-sharing. [source: https://calendly.com/help/how-to-create-a-single-use-link]
- Meeting Polls: invitees vote (no Calendly account needed) on up to 40 proposed time slots, up to 40 participants; can't add slots after publishing; host manually books the winning time; Automations and rescheduling not supported on polls; can book over the host's own buffers but not over confirmed Calendly bookings; optional "Show votes on page" toggle. [source: https://calendly.com/help/meeting-polls-overview]
- Group events: 1 host, invitee limit 2–9,999 per slot, optional "Display remaining spots" counter; uses per-invitee email confirmation + individual non-syncing .ics rather than a shared calendar invite; can't change location/duration/language after first booking (must duplicate event + cancel/reschedule original); event permissions (view/edit/share) require Standard+. [Standard+] [source: https://calendly.com/help/group-event-type-overview]
- Round Robin distribution: **Teams+ only.** Two modes — "Maximize for availability" (books any free host, priority-star tiebreak) or "Optimize for equal distribution" (caps any host from being more than 3 meetings ahead; hides their slots until the team evens out; resets to zero if hosts are added/removed). Reschedules can reassign through round robin or keep the original host. [Teams+] [source: https://calendly.com/help/round-robin-distribution-overview]
- Round robin location options: each host can set their own location, or invitee chooses. [Teams+] [source: https://calendly.com/help/round-robin-meeting-location-options]
- Collective + round robin combos ("multiple groups of hosts"): required hosts always attend while others rotate from a pool. [Teams/Enterprise]
- Email verification requirement for event types (anti-spam gate before booking is allowed). [source: https://calendly.com/help/how-to-require-email-verification-for-event-types]
- Event type language localization for invitee-facing UI (machine-translated). [source: https://calendly.com/help/how-to-change-your-event-type-language]
- Event type permissions: grant other users view/edit/share access per event type. [source: https://calendly.com/help/understand-event-type-permissions]
- Admin-managed events (Teams+): centrally created/standardized event types assigned out to team members with locked settings. [Teams+] [source: https://calendly.com/pricing]
- Additional guests: invitee can add up to 10 guests when booking; guests get the meeting invite, names show on host's Calendar page; not available for group events. [source: https://calendly.com/help/advanced-booking-form-features]
- Invitee questions: custom fields added/removed per event, incl. phone number, consent/opt-in questions; exact full type enumeration (checkbox/dropdown/multi-select/file-upload) not confirmed against one canonical list this pass. [source: https://calendly.com/help/how-to-add-or-remove-invitee-questions]

## Availability

- Schedules: named, reusable weekly-hours templates; create multiple, assign different schedules to different event types via "Active on." [All plans] [source: https://calendly.com/help/how-to-set-your-availability]
- List view (repeating weekly hours) vs. Calendar view (irregular/non-weekly patterns) for building a schedule. [source: same]
- Date-specific hours: override availability for individual dates within a schedule (add/remove time blocks on specific days). [source: same]
- Custom schedule per event type: one-off availability scoped to a single event type without touching other schedules; hours can be copied between event types. [source: same]
- Holidays: toggle observed holidays (from account's country holiday calendar) to auto-block those dates across all scheduling links; editable list. [source: https://calendly.com/help/how-to-edit-holidays-within-calendly]
- Team availability management (admin sets user hours). [Teams+]
- Mutual availability: shows an invitee's own upcoming meetings alongside the host's open times to highlight common free slots (green dots). [source: https://calendly.com/help/mutual-availability-overview]
- Timezone handling: auto-detects both host's and invitee's timezone by default; host's account-level timezone (Profile settings) governs the Calendar page; can lock/override the displayed timezone (recommended for in-person events tied to a physical location); DST changes handled automatically. [source: https://calendly.com/help/time-zones-overview, https://calendly.com/help/how-to-fine-tune-your-availability-settings]
- Troubleshoot tool: diagnostic flow (in event preview) explaining exactly why a given date/time is/isn't bookable — surfaces conflicting calendar events, buffers, limits, date-range, and free/busy rules as reasons. [source: https://calendly.com/help/how-to-troubleshoot-unavailable-times-that-should-be-available]
- Admins/owners can view calendar-connection status for every team member centrally. [source: https://calendly.com/help/availability-overview]
- No dedicated single "pause all bookings"/"away mode" toggle was found — closest equivalents are secret events, date-specific unavailable hours, or raising minimum notice. (Gap.)

## Calendar Integration

- Supported calendars: Google, Outlook/Office 365, Outlook.com, Microsoft Exchange, with two-way sync. iCloud is explicitly not directly connectable — email-confirmation notification mode is recommended for iCloud users instead (iCloud all-day events have a documented display quirk). [source: https://calendly.com/help/connect-your-calendar-to-calendly, https://calendly.com/help/calendly-scheduling-notifications]
- Calendars checked for conflicts vs. calendar bookings are added to are two independently configurable settings. Connection cap by tier: Free = 1, Standard/Teams = 6, Enterprise = unlimited. [source: https://calendly.com/help/how-to-connect-your-google-calendar, https://calendly.com/pricing]
- Busy vs. Free calendar event handling: only events marked "Busy" on a synced calendar block availability; "Free"-marked events don't. Outlook-side Tentative/Away/Working-elsewhere statuses also factor into default busy detection per prior research pass (unconfirmed against current article this pass). [source: https://calendly.com/help/how-to-manage-busy-vs-free-calendar-settings]
- All-day events: block the entire day when marked Busy; must be set Free to stay bookable.
- Multiple calendars/emails: manage several calendar accounts and notification email addresses on one Calendly account. [source: https://calendly.com/help/how-to-manage-multiple-calendars-and-email-addresses]
- Read-only visibility of Google/Outlook meetings surfaced inside Calendly's own Calendar page. [source: https://calendly.com/help/how-to-view-google-or-outlook-meetings-in-calendly]

## Booking Page UX

- Invitee name/email required by default; name field can be single ("Name") or split ("First Name"/"Last Name"). [All plans] [source: https://calendly.com/help/advanced-booking-form-features]
- Autofill invitee name/email/phone from prior bookings (off by default, togglable). [source: same]
- Timezone picker shown on the booking page, defaults to invitee's detected timezone, switchable; 12h/24h display toggle location not independently confirmed on the invitee-facing page this pass (account-level timezone display was confirmed; the exact invitee-facing format toggle wasn't sourced from a dedicated article). (Gap.)
- Invitee questions incl. phone number (auto-prompted for phone-call location type), consent/opt-in questions. [source: https://calendly.com/help/how-to-add-or-remove-invitee-questions, https://calendly.com/help/how-to-collect-consent-from-invitees-with-custom-questions]
- Add guests (up to 10) — see Event Type Settings.
- Prefill invitee info (name, email, custom answers) via URL query params. [source: https://calendly.com/help/how-to-pre-fill-invitee-information-in-your-calendly-link]
- UTM parameter tracking: supports utm_source/medium/campaign/content/term appended to links; filterable/exportable from the Calendar page. [source: https://calendly.com/help/how-to-track-conversions-with-utm-parameters]
- Redirect after booking: send invitees to a custom external URL post-confirmation, optionally passing event details as query params for personalization; also supports adding links to the in-Calendly confirmation page. [source: https://calendly.com/help/how-to-redirect-invitees-to-another-site-after-booking, https://calendly.com/help/how-to-add-links-to-the-event-confirmation-page]
- Branding: custom colors/logo on booking page from Free+; full "remove Calendly branding" white-label and embed color customization are Standard+. [source: https://calendly.com/help/how-to-turn-off-calendly-branding-on-your-scheduling-page, https://calendly.com/pricing]
- Custom scheduling page link/slug (both main landing page and individual event types). [source: https://calendly.com/help/how-to-customize-your-scheduling-page-links]
- Cookie consent banner: GDPR/CCPA-oriented, configurable. [source: https://calendly.com/help/calendly-cookie-management-and-banner]
- Real-time booking by host: host can book on an invitee's behalf, override availability rules, add invitee info manually. [source: https://calendly.com/help/how-to-book-meetings-in-real-time]
- Offer time slots directly inside an email (host picks slots, pastes into an email invite). [source: https://calendly.com/help/how-to-offer-time-slots-in-an-email]
- Link scanning/safety: Calendly scans clicked links for phishing/malware and warns/blocks unsafe ones. Block/report-abuse tools let a host block a specific invitee from booking again. [source: https://calendly.com/help/link-scanning-and-safety, https://calendly.com/help/how-to-block-someone-from-booking-with-you]

## Payments

- Stripe: personal event types use the host's own connected Stripe account; shared/team event types (round robin, collective, group) use the organization owner's Stripe account. Payment methods: major cards, Apple Pay, Google Pay, instant bank payments via Link, buy-now-pay-later (Affirm/Klarna where available). Currencies: USD, CAD, EUR, GBP, AUD. [Standard+] [source: https://calendly.com/help/calendly-stripe]
- Coupon/discount codes per event type, unique names required account-wide; 100%-off coupons skip Stripe checkout entirely. Custom payment terms. [Standard+] [source: same]
- PayPal as an alternate processor (requires a Business PayPal account to receive funds per prior pass). [Standard+] [source: https://calendly.com/help/calendly-paypal]
- Charged at time of booking (invitee completes payment as part of the booking flow, before confirmation) — positioned as a no-show deterrent. [source: https://calendly.com/help/calendly-stripe]
- Refunds are NOT automated — Calendly does not process refunds; the account holder must refund manually via Stripe/PayPal's own dashboard. [source: https://calendly.com/help/calendly-stripe, FAQ: "Does Calendly process refunds? No..."]
- Meeting packages: sell prepaid bundles of one-on-one sessions, invitee books individual sessions over time against the package (private beta / select Stripe-connected users at time of writing). [Standard+] [source: same]
- Payment links: collect one-off payments (deposits, extra fees, digital products) without a scheduled meeting attached. [Standard+] [source: same]
- Invoicing: create/send/track project-based invoices from Calendly. [Standard+] [source: https://calendly.com/help/how-to-send-and-manage-invoices-in-calendly, https://calendly.com/pricing]
- SCA/PSD2 compliance: 3D Secure via Stripe for EU host+invitee transactions. [source: https://calendly.com/help/calendly-stripe]

## Notifications & Workflows

- Two notification mechanisms: **Calendar invitation** (created by the host's connected calendar, live updates propagate to invitee, customizable title) vs. **Email confirmation** (static .ics sent from notifications@calendly.com, no live updates, supports hyperlinks and no-reply sending). Calendly auto-selects based on calendar connection/event type; switchable per event. Group events default to email confirmation. Collective events: calendar event lands on one host's calendar, other hosts added as guests. [All plans] [source: https://calendly.com/help/calendly-scheduling-notifications]
- Host booking notification email always sent from notifications@calendly.com and cannot be turned off. [source: same]
- No-reply sending address option to hide host's real email on email confirmations. [source: https://calendly.com/help/how-to-use-a-no-reply-email-for-confirmations]
- Cancellation policy text field added to the confirmation/notification, plus a toggle to include cancel/reschedule self-service links in emails and reminders. [Paid plans] [source: https://calendly.com/help/how-to-add-a-cancellation-policy, https://calendly.com/help/how-to-include-cancel-and-reschedule-links-for-invitees]
- Automations (Calendly's current name for what was "Workflows"): multi-step, trigger-based email/text sequences (reminders, reconfirmations, follow-ups), template or custom builder, variables for autofill, editable/cloneable/deletable. [source: https://calendly.com/help/automations-overview, https://calendly.com/help/how-to-create-an-automation]
- SMS/text reminders via Automations: character-limit guidance, cancel/reschedule links, legal-disclaimer support for enterprise, org-wide SMS can be fully disabled; invitees can opt out/back in per meeting; sent via Twilio, requires invitee opt-in (GDPR). Not available on Free/Essentials. Per a prior research pass (not re-verified this session): SMS is capped to Group events with ≤100 invitees (larger groups must use email), and new accounts under 60 days old can only use built-in SMS templates, not custom copy. [Standard+] [source: https://calendly.com/help/how-to-send-text-messages-with-automations, https://calendly.com/help/restrict-usage-of-sms-text-messaging, https://calendly.com/help/how-invitees-can-opt-out-or-back-in-to-texts]
- SMS credits: Standard/Teams reportedly include 250 SMS credits/user/month with no overage purchase (hard cap). [Standard/Teams] [MED confidence — sourced from a third-party blog, not confirmed on calendly.com directly]
- Automation emails can be sent from the host's connected Gmail/Outlook (personal event types only, one account) or targeted at non-attendee stakeholders. [source: https://calendly.com/help/how-to-send-automation-emails-from-your-gmail-or-outlook-account, https://calendly.com/help/how-to-send-automation-emails-to-non-meeting-participants]
- No-show marking: host manually marks an invitee as no-show from the Calendar page (available after the meeting's scheduled start); undoable; per-invitee for group events; reflected in CSV export; excluded from generic follow-ups unless an Automation specifically targets no-shows; Standard+ can auto-email no-shows to rebook. [All plans for marking; Standard+ for automated follow-up] [source: https://calendly.com/help/how-to-mark-no-shows-for-meetings]
- Audit log of outgoing communications (email/SMS) for SEC-style compliance review. [source: https://calendly.com/help/auditing-outgoing-communications-sent-from-calendly]

## Cancellation & Rescheduling

- Host-initiated cancel from the Calendar page, or by deleting the synced calendar event (auto-notifies invitee); host-initiated reschedule from the Calendar page (auto-notifies invitee). [source: https://calendly.com/help/how-to-cancel-a-meeting, https://calendly.com/help/how-to-reschedule-a-meeting]
- Invitee-facing self-service cancel/reschedule links optionally included in confirmation/reminder emails. [source: https://calendly.com/help/how-to-include-cancel-and-reschedule-links-for-invitees]
- Cancellation policy text field per event type — informational text, not a system-enforced cutoff rule in the sources reviewed (no explicit "block cancellation within X hours" enforcement setting found). [Standard+] [source: https://calendly.com/help/how-to-add-a-cancellation-policy]
- No-show marking functions as a lightweight cancellation-adjacent status (see Notifications above).
- Manage-meetings hub: view, cancel, reschedule, add internal notes on meetings; syncs with Google/Office 365. [source: https://calendly.com/help/how-to-manage-your-meetings]
- Round robin reschedules: configurable to reassign through the round robin pool or keep the original host. [Teams+] [source: https://calendly.com/help/round-robin-distribution-overview]

## Routing Forms

- Conditional-logic forms that route visitors to the right event type/owner/URL based on their answers (industry, company size, interest, etc.) — a lead-qualification layer in front of scheduling. Per a prior pass: logic combines question/qualifier/answer conditions with AND/OR, routing to an Event Type, a custom screen-out message, or an External URL. [Teams+] [source: https://calendly.com/help/calendly-routing, https://calendly.com/help/how-to-create-a-routing-form]
- Embeddable standalone, or wired to import/route from external form tools: HubSpot, Marketo, Pardot forms; Zapier can also trigger off routing-form submissions. [Teams+] [source: https://calendly.com/help/how-to-embed-a-routing-form, https://calendly.com/help/how-to-embed-routing-from-hubspot-forms]
- CRM-lookup routing: route based on HubSpot or Salesforce ownership/assignment rules (account/contact/lead/opportunity owner), not just form answers. [Teams+/Enterprise for Salesforce lookup] [source: https://calendly.com/help/how-to-set-up-routing-with-hubspot-lookup, https://calendly.com/help/how-to-set-up-routing-with-salesforce-lookup]
- Answer pre-population via URL params; domain-blocking to reject non-business/unwanted email domains. [source: https://calendly.com/help/how-to-pre-populate-invitee-answers-in-routing-forms, https://calendly.com/help/how-to-prevent-scheduling-with-non-business-or-unwanted-email-domains]
- Management: edit permissions, view/filter responses, export results as CSV. [source: https://calendly.com/help/how-to-manage-routing-forms]
- Routing Form submission-to-booking analytics gated to Teams+. [Teams+] [source: https://calendly.com/help/calendly-analytics]

## Embeds

- Three embed styles, no coding required: **Inline embed** (scheduling page rendered directly in page), **Pop-up text** (link opens scheduler in a modal), **Pop-up widget** (persistent floating button opens a modal). [All plans] [source: https://calendly.com/help/embed-options-overview]
- Two embeddable page types: **Landing page embed** (all active event types for a person/team) or **Booking page embed** (single event type). [source: https://calendly.com/help/how-to-add-calendly-to-your-website]
- Per-platform setup guides published for Wix, Unbounce, Squarespace, Shopify, Weebly, Webflow, WordPress, Google Sites, Joomla. [source: https://calendly.com/help/embed-options-overview]
- Advanced embed customization: pass UTM params and prefill data into any embed type, JS-level control for auto-resize and interaction event tracking, documented at "Advanced Calendly embed for developers." [source: https://calendly.com/help/advanced-calendly-embed-for-developers]
- **react-calendly** (community-maintained npm package, `tcampb/react-calendly`) wraps the JS embed API as React components: `InlineWidget` (required `url`; optional height/color/utm/prefill props), `PopupWidget` (requires `rootElement` for portal mount, plus badge styling props `text`/`textColor`/`color`), `PopupButton` (custom trigger element), and a `useCalendlyEventListener` hook exposing the postMessage event set below as callbacks. No official first-party React SDK found — this is the de facto standard. [MED confidence — sourced via package/README search, not a direct scrape] [source: https://www.npmjs.com/package/react-calendly, https://github.com/tcampb/react-calendly]
- Mobile-app embedding also documented. [source: https://calendly.com/help/how-to-embed-calendly-in-a-mobile-app]
- developer.calendly.com's own one-line summary: "Add a Calendly scheduling page to your site or app with a snippet of HTML. Choose inline, popup, or button styles." [source: https://developer.calendly.com/api-docs]
- Developer-level JS config confirmed on the embed recipes page: `Calendly.initInlineWidget`/`initPopupWidget` take a `url` plus a `prefill` object (`name` or `firstName`/`lastName`, `email`, `customAnswers.a1`–`a10`) and a `utm` object (`utmCampaign/Source/Medium/Content/Term`, 255-char limit each — auto-picked-up from the parent page's URL if present, or hardcoded). URL query params `?hide_landing_page_details=1` and `?hide_event_type_details=1` strip redundant chrome. [source: https://developer.calendly.com/api-docs/overview/embedding/getting-started, .../recipes]
- postMessage event bus for the parent window: events are prefixed `calendly.` — `profile_page_viewed`, `event_type_viewed`, `date_and_time_selected`, `event_scheduled`, `page_height` (dynamic iframe resize) — read via `window.addEventListener('message', ...)`. This is what react-calendly's `useCalendlyEventListener` wraps. [source: https://developer.calendly.com/api-docs/overview/embedding/notifying-the-parent-window]

## Sharing

- Direct scheduling links per user/team/event type at `calendly.com/<user>/<event-slug>`, customizable slug for both the main landing page and individual event types. [source: https://calendly.com/help/how-to-customize-your-scheduling-page-links]
- Share via "Add to website" embed snippet generator (see Embeds above).
- Share via email signature button/link. [source: https://calendly.com/help/how-to-add-your-scheduling-link-to-your-email-signature]
- Share availability directly from Gmail/Outlook (browser extension) with auto reminder-after-N-days follow-up. [source: https://calendly.com/help/how-to-share-your-availability-with-gmail-or-outlook-in-calendly]
- No dedicated built-in QR-code generator feature page was found — QR codes are acknowledged only as a generic distribution channel ("update them if your link changes"), suggesting invitees generate their own QR from the link rather than Calendly producing one natively. (Gap — worth a second look.)
- Browser extension and mobile app for one-click link access/sharing anywhere. [source: https://calendly.com/help/extensions]

## Webhooks

Confirmed this session via direct fetch of `developer.calendly.com/api-docs/*` endpoint pages (a separate research pass got past the Stoplight shell that blocked the first attempt).

- 14 webhook event names confirmed on the Create Webhook Subscription endpoint: `invitee.created`, `invitee.canceled`, `invitee_no_show.created`, `invitee_no_show.deleted`, `event_type.created`, `event_type.deleted`, `event_type.updated`, `meeting_recap.created`/`.updated`/`.deleted` (user scope only), `routing_form_submission.created` (organization scope only), `contact.created`/`.updated`/`.deleted`. [source: https://developer.calendly.com/api-docs/calendly-api/webhooks/create-webhook-subscription]
- Subscription scopes: `organization`, `user`, or `group` — supported for most events except `meeting_recap.*` (user-only) and `routing_form_submission.created` (organization-only); each subscription needs a `webhooks:write` auth scope. [source: same]
- Payload is a URI reference only — full invitee detail (name, email, custom-question answers) requires a follow-up `GET /scheduled_events/{event_uuid}/invitees/{invitee_uuid}`. [source: https://developer.calendly.com/docs/api-guides/receive-data-from-scheduled-events-in-real-time-with-webhook-subscriptions]
- Signing: `Calendly-Webhook-Signature` header, format `t=<unix_ts>,v1=<hmac-sha256>`. PAT users can set an optional `signing_key` per subscription; OAuth apps get one auto-generated. Verify by recomputing HMAC over `t + "." + body`; reject if the timestamp is outside a tolerance window (replay protection). [source: https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures]
- Rescheduling emits its own payload shape (a cancel + a new `invitee.created`, documented as a distinct pattern from a plain cancellation). [source: https://developer.calendly.com/docs/api-guides/see-how-webhook-payloads-change-when-invitees-reschedule-events]
- Creating a webhook subscription is gated to paid plans per the prior pass (unconfirmed against a pricing-page line item this session — see gaps).

## API

- Auth: **Personal Access Token** (single-account/internal use) or **OAuth 2.1** (multi-account/public apps acting on behalf of other users). [source: https://developer.calendly.com/docs/authentication/overview]
- REST API v2 resource groups, confirmed via the endpoint sitemap: Event Types (CRUD + one-off event types, available-times, memberships), Scheduled Events (get/list, invitees CRUD, no-show create/delete, cancellation), Availability (schedules, event-type availability get/update, busy times), Users, Organizations (memberships, invitations), Groups, Routing Forms (list/get form + submissions), Contacts (CRUD + custom field defs), Notetaker/meeting recaps (list/get/update/delete + transcript), Activity Log, Outgoing Communications, Webhooks CRUD, Scheduling Links (create), Shares (create), OAuth token endpoints. [source: https://developer.calendly.com/api-docs/calendly-api/*]
- Ships an official **MCP server** exposing scheduling actions to AI agents — direct precedent for bookkit exposing its own MCP/agent surface. [source: https://developer.calendly.com/docs/mcp/calendly-mcp-server]
- **New: Scheduling API** — lets developers "build scheduling directly into your app without redirects, iframes, or Calendly-hosted UI," explicitly positioned for "AI assistants, automation tools, and custom portals," starting at the `create-event-invitee` endpoint. A notable 2026 addition directly relevant to bookkit's own positioning. [source: https://developer.calendly.com/api-docs, https://developer.calendly.com/api-docs/p3ghrxrwbl8kqe-create-event-invitee]
- Rate limits are user-based, not plan-blocked outright: **Free = 50 req/user/min; paid plans = 500 req/user/min**, both for direct and third-party-integration calls; max 8 OAuth token requests/user/min. The Create-Event-Invitee endpoint has its own tighter tiers (Trial 5/day; paid non-Enterprise 10/min · 50/hr · 100/day; Enterprise 500/min). 429 responses carry `X-RateLimit-Limit/Remaining/Reset` headers. [source: https://developer.calendly.com/api-docs/overview/rate-limits]
- A public example app (Buzzword CRM) is published on GitHub demonstrating Scheduling API use cases. [source: https://github.com/calendly/buzzword-crm]

## Analytics

- Built-in in-app Analytics dashboard: tracks created, completed, rescheduled, canceled events; event distribution by duration; popular events; popular times — up to **1 year** of history. Available to **Owners/Admins only**, on Professional/Standard/Standard Plus/Teams/Teams Plus/Enterprise (i.e., not Free). [Standard+] [source: https://calendly.com/help/calendly-analytics]
- Dashboard filters: date range, user, team, group, event type; customizable widget layout; CSV export (Event Data or Employee/user Data). [source: same]
- Routing Form submission-to-booking analytics gated to Teams+. [Teams+] [source: same]
- Separate "Tracking and reporting" capability: UTM tags, Google Analytics, Meta Pixel integration for conversion tracking, custom JS embed events, detailed meeting CSV export. [Standard+ for GA/Meta Pixel per pricing page] [source: https://calendly.com/help/tracking-and-reporting, https://calendly.com/pricing]
- Admin dashboard (Teams+, per prior pass, unverified this session): overview split into "Your team" and "Activity last week," linking to org user list and analytics. [Teams+] [source: prior pass]

## Contacts

- "Contacts" = lightweight CRM: auto-generated contact profiles + relationship history built from meeting activity; notes, reminders, custom fields, lists; book directly from a contact's profile. [source: https://calendly.com/help/contacts-overview]
- Direct email-from-Calendly (Gmail sync, AI-drafted emails, templates, bulk send) is a paid-plan capability. [Standard+] [source: same, https://calendly.com/pricing]
- "Follow up on missed opportunities": auto-identifies contacts who received a link but never booked, for re-outreach (marked Limited Availability at time of writing). [source: https://calendly.com/help/contacts-overview]

## GDPR & Compliance

- Full data-subject-rights support mapped to GDPR/CCPA categories: **access/portability** (export Contacts, Calendar meeting data, Notetaker recap/transcript downloads), **rectification** (edit a Contact's fields), **erasure/right-to-be-forgotten** (delete Contact records, delete Notetaker recaps individually or in bulk), **restriction of processing** and **right to object** (handled via support-ticket assistance, or deleting the data subject entirely). [All plans] [source: https://calendly.com/help/how-does-calendly-help-customers-with-data-subject-rights]
- Standalone personal-data-deletion flow for GDPR/CCPA. [source: https://calendly.com/help/how-to-delete-personal-data-in-calendly]
- **Data Deletion API** for programmatic compliance workflows — Enterprise only, confirmed at the endpoint level (`delete-invitee-data`, `delete-scheduled-event-data`), requires `data_compliance:write` scope; deletion can take up to 7 days. [Enterprise] [source: https://calendly.com/pricing, https://developer.calendly.com/api-docs/calendly-api/data-compliance/delete-invitee-data]
- SOC 2 report and ISO/IEC 27001 compliance report both available on request via Calendly's Whistic Security Center (NDA required). [source: https://calendly.com/help/soc-compliance, https://calendly.com/help/iso-iec-27001-compliance]
- Data storage in U.S. data centers; international transfer safeguards (Standard Contractual Clauses, UK Addendum) for EEA/UK customers. [source: https://calendly.com/help/data-storage-and-international-data-transfers]
- Cookie management/banner for GDPR/CCPA consent on booking pages. [source: https://calendly.com/help/calendly-cookie-management-and-banner]
- Sub-processor disclosure list maintained for GDPR/CCPA. [source: https://calendly.com/help/calendly-sub-processors-gdpr-ccpa]
- Enterprise security add-ons: SAML SSO, SCIM user/group provisioning, Domain Control (admin oversight of company-domain accounts, force-SSO, signup locking), account/activity audit log; SSO also purchasable as a Teams add-on. [Enterprise; SSO add-on on Teams] [source: https://calendly.com/pricing, https://calendly.com/help/domain-control-with-calendly, https://calendly.com/help/the-activity-log]
- Two-factor authentication / OTP login verification for email+password accounts. [source: https://calendly.com/help/calendly-login-verification-for-email-and-password-users]

## Accessibility

- Calendly publishes a **VPAT (Voluntary Product Accessibility Template)** — an "Accessibility Conformance Report, WCAG Edition" — documenting how the platform meets WCAG standards, available to users on request. [source: https://calendly.com/help/voluntary-product-accessibility-template-vpat]
- Calendly's own accessibility statement claims most flows meet WCAG 2.1 AA with ongoing remediation, but the published VPAT is dated from a Nov–Dec 2021 evaluation — likely stale relative to the current 2026 product. [source: https://calendly.com/legal/web-accessibility-statement, https://calendly.com/help/voluntary-product-accessibility-template-vpat]

## Calendar Sync & ICS

- ICS attachment behavior: under "Email confirmation" notification mode, Calendly sends a static .ics file (non-updating, can't be customized) instead of a live calendar invite; under "Calendar invitation" mode, the host's own connected calendar (Google/Outlook/Exchange) generates and sends the live, updatable invite instead of Calendly directly emailing an ICS. Group events always use the email/.ics confirmation path, each invitee getting their own non-syncing .ics. [source: https://calendly.com/help/calendly-scheduling-notifications]
- Collective event types: the calendar event lands on one team member's calendar, with the other hosts added as guests. [source: same]
- Multi-calendar conflict checking and destination-calendar selection: see Calendar Integration above.

## Admin / Security (Teams & Enterprise, for OSS-adopter context)

- Groups + delegated admins, org-wide Zoom connect, centrally-managed event types. [Teams+] [source: https://calendly.com/pricing]
- SSO/SAML (paid add-on on Teams, included on Enterprise), SCIM provisioning, automated group provisioning, domain control/account oversight, audit-log compliance, security & legal review support. [Enterprise, SSO add-on exception on Teams] [source: https://calendly.com/pricing]

---

## Didn't check / gaps

- **webclaw's `search` tool required a WEBCLAW_API_KEY not configured in this environment** across all research passes, so full-text search across help.calendly.com/developer.calendly.com wasn't available — research relied on direct URL scraping/WebSearch against known or discovered pages. Some narrow-topic articles may exist uncovered.
- **No explicit "pause all bookings"/away-mode toggle** found as a single named feature (checked across two independent passes).
- **No explicit built-in QR-code generator** for a booking link found as a named feature — confirmed independently across two research passes (one explicitly checked the current 2026 help center and found nothing); treat as genuinely absent from the product, not just unconfirmed. Possible bookkit differentiator.
- **Cancellation cutoff enforcement**: confirmed absent by two independent passes, including a direct Calendly Community forum thread of a customer asking for exactly this and getting a "not supported" answer — only a freeform cancellation-policy text field exists, no system-enforced "no cancellations within X hours" rule. [source: https://community.calendly.com/how-do-i-40/is-there-a-way-to-prevent-rescheduling-canceling-by-cllients-24-hours-or-less-before-a-meeting-1808]
- **Structured cancellation-reason capture** (invitee picks/types why they're canceling as structured data, not just free text) — not found in any pass; likely absent.
- **Accessibility**: VPAT existence and its 2021 evaluation date confirmed; the report's exact stated conformance level (AA vs. partial) not independently read.
- **12h/24h time-format toggle** on the invitee-facing booking page not confirmed from a dedicated article across any pass.
- Meeting Polls (40 slots/40 participants) and Group event (9,999 max invitees) numeric caps sourced from a single article each, not cross-verified against a second source.
- react-calendly exact prop list sourced from package/README search summaries, not a direct scrape of the README — verify exact prop names before writing bookkit code against it as a reference implementation.
- Exact invitee-question type enumeration is now reasonably well confirmed (One line, Multiple lines, Radio buttons, Checkboxes, Dropdown, Phone number) but sourced from one article; worth a second check before finalizing bookkit's question-type schema.
- Monthly (non-annual) exact per-seat pricing for Standard/Teams — pricing page defaulted to the annual-billed toggle showing only "Save 17%/20%" vs. monthly, not the monthly dollar figure itself.
- Whether the core (non-webhook) REST API is itself plan-gated vs. just rate-limited-lower-on-Free is inferred from the rate-limit table, not an explicit gating statement — verify against the current pricing page's feature matrix before assuming Free-tier API access works in practice.
- SSO/SAML/SCIM setup detail (beyond that it's an Enterprise/Teams-add-on line item) not independently verified.
