"use strict";
/**
 * Stripe billing — Fam ETC web.
 *
 * Product model (per APP-BRIEF.md):
 *   • FREE 30-day trial — NO card required. Tracked from the account's createdAt;
 *     there is no Stripe object for it. Every new web account gets full access for
 *     30 days without entering payment details.
 *   • Annual subscription — Stripe Checkout (mode: subscription, NO Stripe trial —
 *     the free trial above replaces it). Self-service cancel/card update via the
 *     Stripe Customer Portal.
 *   • Lifetime — an OPTIONAL one-time purchase (mode: payment). Grants permanent
 *     access. Set STRIPE_LIFETIME_PRICE_ID to enable; leave unset to omit it.
 * The web app is gated on: free trial OR active annual sub OR lifetime OR
 * grandfathered. iOS ships free at launch (see brief) — StoreKit 2 IAP later,
 * never Stripe in-app; iOS accounts are grandfathered so flipping on IAP never
 * locks out existing iOS users.
 *
 * ── SETUP (one-time, in your Stripe Dashboard) ─────────────────────────────
 *  1. Recurring annual Price (USD) → STRIPE_PRICE_ID (price_…).
 *  2. Optional one-time lifetime Price (USD) → STRIPE_LIFETIME_PRICE_ID (price_…).
 *  3. RESTRICTED API key (rk_…): write on Customers, Checkout Sessions, Billing
 *       Portal; read on Subscriptions, Prices, PaymentIntents.
 *  4. Webhook → https://www.fametc.com/api/billing/webhook with events:
 *       checkout.session.completed, customer.subscription.created/updated/deleted,
 *       invoice.payment_failed.  Copy the signing secret (whsec_…).
 *  5. Env vars on the server (NOT in source control):
 *       STRIPE_SECRET_KEY=rk_live_…   STRIPE_PRICE_ID=price_…
 *       STRIPE_LIFETIME_PRICE_ID=price_…   STRIPE_WEBHOOK_SECRET=whsec_…
 *     Optional: BILLING_PORTAL_RETURN_URL, STRIPE_LIFETIME_OFFER_END (ms epoch),
 *     TRIAL_DAYS.
 *
 * Gating is enforced only when SECRET_KEY + PRICE_ID + WEBHOOK_SECRET are all set
 * (the lifetime price is optional — without it, only annual is offered). With any
 * of the three missing, the app runs ungated, so deploying before the keys exist
 * never locks anyone out and local dev stays open. Test mode until launch, per brief.
 */
const db = require("./db");
const store = require("./store");

// Latest Stripe API version per the integration guidance. Pinning here keeps
// behaviour stable across SDK upgrades; the value is just a request header.
const API_VERSION = "2026-05-27.dahlia";

const SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const PRICE_ID = process.env.STRIPE_PRICE_ID || "";        // recurring $49.99/yr
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
// Optional second product: a limited-time ONE-TIME "lifetime" purchase ($79).
// Create a one-time Price in Stripe and set STRIPE_LIFETIME_PRICE_ID. The offer
// sells only until LIFETIME_OFFER_END; after that the option disappears and the
// server refuses a lifetime checkout (the annual plan is always available).
const LIFETIME_PRICE_ID = process.env.STRIPE_LIFETIME_PRICE_ID || "";
// End of the limited-time window: through the end of Sept 30, 2026 in US Pacific
// (≈ Oct 1 07:59 UTC) so Americas customers get all of Sep 30. Override via env.
// LABEL is a fixed display string so the UI never drifts to "Oct 1" via timezone
// formatting of the timestamp.
const LIFETIME_OFFER_END = Number(process.env.STRIPE_LIFETIME_OFFER_END) || Date.UTC(2027, 0, 1, 7, 59, 59, 999);
const LIFETIME_OFFER_END_LABEL = "TBD"; // set a real date once the lifetime offer is decided
// Free trial: 30 days, NO card required. Tracked purely from the account's
// createdAt — there is no Stripe object for it (the user enters no payment
// details to trial). Override the length via env if needed.
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Display labels for the UI. They must match the amounts on the Stripe Prices.
// TODO: set real pricing before launch (see docs/IAP-PLAN.md).
const ANNUAL_PRICE = process.env.ANNUAL_PRICE_LABEL || "TBD";
const LIFETIME_PRICE = process.env.LIFETIME_PRICE_LABEL || "TBD";

let _stripe = null;
function client() {
  if (!SECRET_KEY) return null;
  if (!_stripe) {
    const Stripe = require("stripe");
    _stripe = new Stripe(SECRET_KEY, { apiVersion: API_VERSION });
  }
  return _stripe;
}

// Gating is live only when fully configured. Any missing piece → open app.
function enabled() {
  return !!(SECRET_KEY && PRICE_ID && WEBHOOK_SECRET);
}

// Stripe subscription statuses that grant access. `past_due` keeps access while
// Stripe's automatic dunning/retries run, so a temporary card decline doesn't
// instantly lock a paying customer out.
const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

// When the account's free 30-day trial ends (ms epoch), or null if no createdAt.
function trialEndsAt(user) {
  if (!user || !user.createdAt) return null;
  const start = Date.parse(user.createdAt);
  return Number.isFinite(start) ? start + TRIAL_DAYS * DAY_MS : null;
}
// Is the user inside their free, no-card trial window?
function inFreeTrial(user) {
  const end = trialEndsAt(user);
  return end != null && Date.now() < end;
}
// A one-time lifetime purchase grants permanent access.
function hasLifetime(user) {
  return !!(user && user.billing && user.billing.lifetime);
}
// Has the user committed money (active annual sub OR lifetime)? — distinct from
// being on the free trial, which involves no payment.
function hasPaidPlan(user) {
  if (!user) return false;
  if (hasLifetime(user)) return true;
  return ACTIVE_STATUSES.has((user.billing || {}).status);
}
// Is the limited-time lifetime offer currently sellable?
function lifetimeOfferOpen() {
  return Date.now() <= LIFETIME_OFFER_END;
}
function lifetimeAvailable() {
  return enabled() && !!LIFETIME_PRICE_ID && lifetimeOfferOpen();
}

// Does this user currently have access to the gated app?
function entitled(user) {
  if (!enabled()) return true; // not configured → never gate
  if (!user) return false;
  const b = user.billing || {};
  if (b.status === "grandfathered") return true;
  if (hasLifetime(user)) return true;             // one-time lifetime purchase
  if (ACTIVE_STATUSES.has(b.status)) return true; // active annual subscription
  if (inFreeTrial(user)) return true;             // free 30-day, no-card trial
  // Safety net: anyone whose account predates the one-time grandfather snapshot
  // is treated as grandfathered even if the explicit stamp didn't take.
  const g = store.metaGet("grandfatheredAt");
  if (g && user.createdAt && user.createdAt < g) return true;
  return false;
}

// Has the user actually PAID (active annual sub or lifetime)? The free trial is
// deliberately excluded — it involves no payment. Used to decide whether
// "finishing payment" should trigger the save-your-recovery-codes prompt.
function paidOrTrialing(user) {
  if (!enabled() || !user) return false;
  return hasPaidPlan(user);
}

// Record a completed one-time lifetime purchase on the user.
function applyLifetime(user, session) {
  if (!user) return;
  const customer = session && (typeof session.customer === "string" ? session.customer : session.customer && session.customer.id);
  user.billing = Object.assign({}, user.billing, {
    lifetime: true,
    status: "lifetime",
    stripeCustomerId: customer || (user.billing && user.billing.stripeCustomerId) || null,
    purchasedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.saveUser(user);
}

// Compact, client-safe view of a user's billing state for the /billing UI.
function publicStatus(user) {
  const b = (user && user.billing) || {};
  const trialEnd = trialEndsAt(user);
  const onTrial = inFreeTrial(user);
  return {
    enabled: enabled(),
    entitled: entitled(user),
    status: b.status || "none",
    // Free no-card trial
    onFreeTrial: onTrial,
    trialEndsAt: trialEnd,
    trialDaysLeft: trialEnd ? Math.max(0, Math.ceil((trialEnd - Date.now()) / DAY_MS)) : 0,
    // Paid plans
    lifetime: hasLifetime(user),
    hasPaidPlan: hasPaidPlan(user),
    currentPeriodEnd: b.currentPeriodEnd || null,
    cancelAtPeriodEnd: !!b.cancelAtPeriodEnd,
    hasCustomer: !!b.stripeCustomerId,
    // Offer/catalog
    annualPrice: ANNUAL_PRICE,
    lifetimePrice: LIFETIME_PRICE,
    lifetimeAvailable: lifetimeAvailable(),
    lifetimeOfferEnds: LIFETIME_OFFER_END,
    lifetimeOfferEndsLabel: LIFETIME_OFFER_END_LABEL,
  };
}

// Map a Stripe Subscription object onto our user record. Defensive about where
// the period end lives — newer API versions moved current_period_end onto the
// subscription item, so read both.
function applySubscription(user, sub) {
  if (!user || !sub) return;
  const item = sub.items && sub.items.data && sub.items.data[0];
  const periodEnd = sub.current_period_end || (item && item.current_period_end) || null;
  user.billing = Object.assign({}, user.billing, {
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : (sub.customer && sub.customer.id) || user.billing?.stripeCustomerId || null,
    subscriptionId: sub.id,
    status: sub.status, // trialing | active | past_due | canceled | unpaid | incomplete | …
    priceId: (item && item.price && item.price.id) || user.billing?.priceId || null,
    currentPeriodEnd: periodEnd ? periodEnd * 1000 : null,
    trialEnd: sub.trial_end ? sub.trial_end * 1000 : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    updatedAt: new Date().toISOString(),
  });
  store.saveUser(user);
}

// Resolve which of our users a webhook event belongs to. Prefer the explicit
// userId we stamp into metadata; fall back to the Stripe customer id we stored
// when the customer was created.
function userForEvent(obj) {
  const uid = obj && obj.metadata && obj.metadata.userId;
  if (uid) {
    const u = store.getUser(uid);
    if (u) return u;
  }
  const customer = obj && (typeof obj.customer === "string" ? obj.customer : obj.customer && obj.customer.id);
  if (customer) {
    const u = store.findByStripeCustomerId(customer);
    if (u) return u;
  }
  const clientRef = obj && obj.client_reference_id;
  if (clientRef) {
    const u = store.getUser(clientRef);
    if (u) return u;
  }
  return null;
}

module.exports = {
  enabled,
  client,
  entitled,
  paidOrTrialing,
  hasPaidPlan,
  hasLifetime,
  inFreeTrial,
  trialEndsAt,
  lifetimeOfferOpen,
  lifetimeAvailable,
  applyLifetime,
  publicStatus,
  applySubscription,
  userForEvent,
  PRICE_ID,
  LIFETIME_PRICE_ID,
  LIFETIME_OFFER_END,
  TRIAL_DAYS,
  WEBHOOK_SECRET,
  API_VERSION,
};
