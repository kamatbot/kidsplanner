"use strict";

module.exports = (app, deps) => {
  const { billing, store, requireAuth, requireParent, CANONICAL_HOST } = deps;

  // ===================== BILLING (Stripe) =====================
  // NOTE: the webhook (/api/billing/webhook) stays in server.js — it must be
  // registered before express.json() for raw-body signature verification.
  app.get("/api/billing/status", requireAuth, requireParent, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(billing.publicStatus(req.user));
  });

  app.post("/api/billing/checkout", requireAuth, requireParent, async (req, res) => {
    if (!billing.enabled()) return res.status(503).json({ error: "Billing is not configured." });
    if (billing.hasPaidPlan(req.user)) {
      return res.status(409).json({ error: "You already have an active plan.", code: "already_subscribed" });
    }
    const plan = (req.body && req.body.plan) === "lifetime" ? "lifetime" : "annual";
    if (plan === "lifetime" && !billing.lifetimeAvailable()) {
      const ended = !billing.lifetimeOfferOpen();
      return res.status(410).json({
        error: ended ? "The lifetime offer has ended — the annual plan is still available."
                     : "The lifetime offer isn't available right now — the annual plan is still available.",
        code: ended ? "offer_closed" : "offer_unavailable",
      });
    }
    const stripe = billing.client();
    try {
      let customerId = req.user.billing && req.user.billing.stripeCustomerId;
      if (customerId) {
        try {
          const existing = await stripe.customers.retrieve(customerId);
          if (existing.deleted) customerId = null;
        } catch (e) {
          if (e && (e.code === "resource_missing" || e.statusCode === 404)) customerId = null;
          else throw e;
        }
      }
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: req.user.email || undefined,
          name: req.user.data.profile.name || undefined,
          metadata: { userId: req.user.id },
        });
        customerId = customer.id;
        req.user.billing = Object.assign({}, req.user.billing, {
          stripeCustomerId: customerId,
          status: (req.user.billing && req.user.billing.status) || "none",
          updatedAt: new Date().toISOString(),
        });
        store.saveUser(req.user);
      }
      const common = {
        customer: customerId,
        client_reference_id: req.user.id,
        allow_promotion_codes: true,
        metadata: { userId: req.user.id, plan },
        success_url: `${CANONICAL_HOST}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${CANONICAL_HOST}/billing?status=cancel`,
      };
      const session = plan === "lifetime"
        ? await stripe.checkout.sessions.create({
            ...common,
            mode: "payment",
            line_items: [{ price: billing.LIFETIME_PRICE_ID, quantity: 1 }],
            payment_intent_data: { metadata: { userId: req.user.id, plan: "lifetime" } },
          })
        : await stripe.checkout.sessions.create({
            ...common,
            mode: "subscription",
            line_items: [{ price: billing.PRICE_ID, quantity: 1 }],
            subscription_data: { metadata: { userId: req.user.id } },
          });
      res.json({ url: session.url });
    } catch (e) {
      console.error("[billing] checkout error:", e.message);
      res.status(502).json({ error: "Could not start checkout. Please try again." });
    }
  });

  app.post("/api/billing/portal", requireAuth, requireParent, async (req, res) => {
    if (!billing.enabled()) return res.status(503).json({ error: "Billing is not configured." });
    const customerId = req.user.billing && req.user.billing.stripeCustomerId;
    if (!customerId) return res.status(400).json({ error: "No billing account yet — start a plan first." });
    const stripe = billing.client();
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: process.env.BILLING_PORTAL_RETURN_URL || `${CANONICAL_HOST}/billing`,
      });
      res.json({ url: portal.url });
    } catch (e) {
      console.error("[billing] portal error:", e.message);
      res.status(502).json({ error: "Could not open the billing portal. Please try again." });
    }
  });
};
