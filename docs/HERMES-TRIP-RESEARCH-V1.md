# Hermes Trip Research v1 — End-to-end narrow use case

This slice turns the existing Trips group chat into a useful travel-research assistant without widening the Operator's external-write authority.

## Product behavior

1. **Ambient Trip awareness.** Every human Trip-chat message remains part of a bounded read-only Trip snapshot. Ordinary messages do not invoke Hermes. When someone later writes `@Hermes`, the trigger receives the current trip plus recent crew conversation, so dates, hotel preferences, flight constraints and activity ideas do not need to be repeated.
2. **Current web research on the Hermes host Mac.** For explicit Trip-room requests about flights, hotels or activities, the FamETC Hermes adapter instructs Hermes to use its browser/web tools and only report price/availability/rating/schedule information it actually observed in that run.
3. **Typed research results.** Hermes appends one `fametc_travel` JSON block using `hermes-travel-results-v1`. FamETC removes that machine block from visible prose, validates the card, requires HTTPS links, caps result counts and stores the sanitized card with the chat message.
4. **Actionable Trip chat UX.** Trip chat renders flight, hotel and activity options as compact cards with source, current research timestamp, price/rating/details, an `Open option` link, and `Save as trip idea`. Saving creates an ordinary Trip itinerary idea through the existing authenticated Trip API; it does not create a booking.
5. **Fail-closed boundary.** Shared Trip rooms still receive no Family Operator actor capability. Research results cannot book, purchase, send messages, submit forms, or become execution authority. Booking can be layered later behind a separate exact-approval workflow.

## Context contract

`fametc.trip-context.v1` includes:

- trip name, destination and dates;
- member display names/roles;
- current itinerary;
- existing flight schedule data without confirmation codes;
- current lodging data without confirmation codes;
- shared packing/checklist state;
- up to 120 recent human Trip-chat messages, bounded by per-message and aggregate character caps.

All values are explicitly `read-only` and `untrusted data`. The snapshot grants no approval and no write authority.

## Travel result contract

The server accepts only cards with:

- `schemaVersion: 1`;
- `type: hermes-travel-results`;
- `id: hermes-travel-results-v1`;
- kind `flight`, `hotel`, `activity`, or `mixed`;
- 1–6 results;
- HTTPS result URLs with no embedded credentials;
- bounded titles, subtitles, prices, ratings and detail chips;
- optional itinerary suggestion used only by the human-facing `Save as trip idea` action.

Malformed rows are discarded. A card with no valid result is not rendered as structured research.

## Hermes host requirement

The local Hermes installation needs its normal browser/web tools enabled. FamETC does not proxy arbitrary browsing through its server; research happens in the Hermes runtime on the host Mac, keeping the control-plane boundary narrow. The adapter prompt requires current browsing for dynamic travel claims and prohibits claiming a booking or reservation.

## What v1 deliberately does not do

- no autonomous booking;
- no payment;
- no form submission;
- no email or WhatsApp outreach;
- no confirmation-code disclosure to Hermes Trip context;
- no Trip-room Operator actor token;
- no passive replies to ordinary crew conversation.

The next narrow increment, if this proves useful, is a reviewed booking proposal that turns one selected research result into an exact-action approval rather than giving the browser general write authority.
