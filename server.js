"use strict";
/**
 * Fam ETC — the etcetera hub for your family. Express server: passkey
 * (WebAuthn) parent auth, family groups (invite code, kid profiles),
 * encrypted-at-rest chat + calendar/homework/goals data, and Stripe billing.
 *
 * Scaffolded from the RetireOdds server foundation — see APP-BRIEF.md for the
 * full rename map and component plan. Signup is PARENT-ONLY (see "Kids'
 * privacy & compliance" in the brief): there is no kid signup path anywhere.
 */
require("./lib/loadenv").load(); // hydrate process.env from a local .env (no-op in prod)
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const compression = require("compression");
const cookieSession = require("cookie-session");
const multer = require("multer");

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const store = require("./lib/store");
const db = require("./lib/db");
const billing = require("./lib/billing");
const backupCodes = require("./lib/backup-codes");
const analytics = require("./lib/analytics");
const family = require("./lib/family");
const chat = require("./lib/chat");
const kidAccess = require("./lib/kid-access");
const events = require("./lib/events");
const gifs = require("./lib/gifs");
const schoolFeeds = require("./lib/school-feeds");
const homework = require("./lib/homework");
const notes = require("./lib/notes");
const wordbank = require("./lib/wordbank");
const brainteaser = require("./lib/brainteaser");
const schoolAccount = require("./lib/school-account");
const moodleClient = require("./lib/moodle-client");
const notifications = require("./lib/fam-notifications");
const { rpForRequest, toB64url, fromB64url } = require("./lib/webauthn");

const app = express();
const PORT = process.env.PORT || 4000;
const PUBLIC = path.join(__dirname, "public");

// Canonical host for SEO. All indexable URLs resolve to this origin, and the
// bare apex 301-redirects here so www / non-www don't split ranking signals.
const CANONICAL_HOST = process.env.CANONICAL_HOST || "https://www.fametc.com";

// Behind Hostinger/Passenger: honour X-Forwarded-* so protocol/host are
// accurate. Trust exactly ONE proxy hop; a non-integer TRUST_PROXY must never
// become Express's trust-ALL mode (that would let X-Forwarded-For be spoofed
// past the per-IP rate limiter below).
const _tp = Number(process.env.TRUST_PROXY);
app.set("trust proxy", Number.isInteger(_tp) && _tp >= 0 ? _tp : 1);
app.disable("x-powered-by");

app.use(compression());

// ---------- security headers ----------
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "img-src 'self' data: blob: https://*.giphy.com",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "form-action 'self'",
  "report-uri /csp-report",
  "upgrade-insecure-requests",
].join("; ");
app.use((req, res, next) => {
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), browsing-topics=()");
  res.setHeader("Content-Security-Policy", CSP);
  next();
});
app.post("/csp-report", (req, res) => res.status(204).end());

// ---------- iOS Associated Domains (passkeys) ----------
// Apple fetches this WITHOUT following redirects, so it must be served on the
// apex (fametc.com, the WebAuthn RP ID) and BEFORE the apex->www redirect.
const IOS_APP_IDS = [...new Set([
  ...(process.env.IOS_APP_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  "B4F73U5RGR.com.fametc.app",
])];
app.get("/.well-known/apple-app-site-association", (req, res) => {
  res.type("application/json").setHeader("Cache-Control", "public, max-age=3600");
  res.json({ webcredentials: { apps: IOS_APP_IDS } });
});

// 301 non-www apex -> www.
app.use((req, res, next) => {
  const host = (req.headers.host || "").toLowerCase();
  if (host === "fametc.com") {
    return res.redirect(301, CANONICAL_HOST + req.originalUrl);
  }
  next();
});

// 301 trailing slash -> no-slash.
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith("/")) {
    const qs = req.url.slice(req.path.length);
    return res.redirect(301, req.path.replace(/\/+$/, "") + qs);
  }
  next();
});

// ---------- Stripe webhook ----------
// MUST be registered BEFORE express.json(): signature verification needs the
// exact raw request bytes.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!billing.enabled()) return res.status(503).end();
  const stripe = billing.client();
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, billing.WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed`);
  }
  try {
    const obj = event.data && event.data.object;
    switch (event.type) {
      case "checkout.session.completed": {
        const user = billing.userForEvent(obj);
        if (user) {
          if (obj.mode === "payment" || (obj.metadata && obj.metadata.plan === "lifetime")) {
            billing.applyLifetime(user, obj);
          } else if (obj.subscription) {
            const sub = await stripe.subscriptions.retrieve(obj.subscription);
            billing.applySubscription(user, sub);
          }
        }
        try { analytics.recordPaid({}); } catch (e) { /* never fail a webhook on analytics */ }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const user = billing.userForEvent(obj);
        if (user) billing.applySubscription(user, obj);
        break;
      }
      case "invoice.payment_failed": {
        const user = billing.userForEvent(obj);
        const subId = obj.subscription;
        if (user && subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          billing.applySubscription(user, sub);
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error("[billing] webhook handler error:", e.message);
    return res.status(500).end();
  }
  res.json({ received: true });
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Content-hash build tag for asset cache-busting (?v=BUILD).
const BUILD = (() => {
  try {
    const files = ["css/styles.css", "js/app.js", "js/auth.js", "js/school-stats.js"].map((f) => fs.readFileSync(path.join(PUBLIC, f)));
    return crypto.createHash("md5").update(Buffer.concat(files)).digest("hex").slice(0, 10);
  } catch (e) {
    return String(Date.now());
  }
})();

// Human-readable, timestamped build label so any given deploy is identifiable
// in the startup log and at /api/health (e.g. "20260703-1547Z-6e4b7d8"). It is
// written into build-info.json at package/deploy time (see the deploy step);
// falls back to the content hash when the file is absent (e.g. local dev). This
// is what lets us say "what went wrong with which build".
const BUILD_INFO = (() => {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8"));
    return { label: info.label || BUILD, builtAt: info.builtAt || null, commit: info.commit || null };
  } catch (e) {
    return { label: BUILD, builtAt: null, commit: null };
  }
})();

const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PROD = process.env.NODE_ENV === "production" || !!SESSION_SECRET;
if (IS_PROD && !SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production (refusing to start with a default secret).");
}
if (!SESSION_SECRET) {
  console.warn("[auth] SESSION_SECRET is not set — using an INSECURE dev secret. Never run this in production.");
}
app.use(
  cookieSession({
    name: "fam_sess",
    keys: [SESSION_SECRET || "fametc-dev-secret-change-me"],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
  })
);

// Uploads: timetable/homework photos (JPG/PNG/PDF) feeding the Claude parse
// pipeline. No worker pool (brief: skip simpool.js) — parsing happens client-
// side today (see FEATURE_PLAN.md); this just accepts the raw upload.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 20 } });

// ---------- rate limiting ----------
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  const MAX_KEYS = envNum("RL_MAX_KEYS", 50000);
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, Math.min(windowMs, 60 * 1000));
  if (sweep.unref) sweep.unref();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    let rec = hits.get(ip);
    if (!rec || rec.resetAt <= now) {
      if (hits.size >= MAX_KEYS) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count++;
    const resetSec = Math.ceil((rec.resetAt - now) / 1000);
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - rec.count));
    res.setHeader("RateLimit-Reset", resetSec);
    if (rec.count > max) {
      res.setHeader("Retry-After", resetSec);
      return res.status(429).json({ error: message || "Too many requests — please slow down and try again in a moment." });
    }
    next();
  };
}
function envNum(name, def) {
  return Number(process.env[name]) > 0 ? Number(process.env[name]) : def;
}
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: envNum("RL_API_MAX", 300) });
const gifLimiter = rateLimit({ windowMs: 60 * 1000, max: envNum("RL_GIF_MAX", 60), message: "Too many GIF searches — please slow down and try again in a moment." });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: envNum("RL_AUTH_MAX", 60), message: "Too many sign-in attempts — please wait a minute and try again." });
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: envNum("RL_SIGNUP_MAX", 15), message: "Too many sign-up attempts — please try again later." });
app.use("/api", apiLimiter);

// ---------- helpers ----------
function currentUser(req) {
  const id = req.session && req.session.uid;
  return id ? store.getUser(id) : null;
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  req.user = user;
  next();
}
function userRole(user) {
  return (user && user.data && user.data.profile && user.data.profile.role) || "parent";
}
// Blocks kid sessions from parent-only actions (billing, family management,
// member/kid removal, backup codes, account deletion, kid-device provisioning
// itself). See APP-BRIEF.md "Kids' privacy & compliance" — kids are role-
// scoped to their own calendar/homework/goals + family chat only.
function requireParent(req, res, next) {
  if (userRole(req.user) === "kid") return res.status(403).json({ error: "Parents only." });
  next();
}
// The user's primary family. Parents resolve it via family.familiesForUser
// (parents currently belong to at most one family in this scaffold); kid
// users have no parentIds membership, so resolve via their user.data.kid
// linkage instead — a kid must reach their own family for chat, calendar, etc.
function requireFamily(req, res, next) {
  if (userRole(req.user) === "kid") {
    const fam = family.familyForKidUser(req.user);
    if (!fam) return res.status(404).json({ error: "No family found for this account." });
    req.family = fam;
    return next();
  }
  const fams = family.familiesForUser(req.user.id);
  if (!fams.length) return res.status(404).json({ error: "No family yet — create or join one first." });
  req.family = fams[0];
  next();
}

function isIOSClient(req) {
  const secret = process.env.IOS_CLIENT_SECRET;
  if (secret) {
    const secretMatch = (presented, s) => typeof presented === "string" && presented.length === s.length && crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(s));
    if (secretMatch(req.get("x-fametc-client-key") || "", secret)) return true;
    const m = /FamETC-?iOS\/([A-Za-z0-9._-]+)/.exec(req.get("user-agent") || "");
    return !!(m && secretMatch(m[1], secret));
  }
  if ((req.get("x-fametc-client") || "").toLowerCase() === "ios") return true;
  return /FamETC-?iOS/i.test(req.get("user-agent") || "");
}

// A short, human-friendly device label for a kid access request, so the parent
// sees "an iPad" / "an iPhone" rather than a raw user-agent string. Best-effort.
function deviceLabelFromUA(req) {
  const ua = req.get("user-agent") || "";
  if (/FamETC-?iOS/i.test(ua)) return "the Fam ETC app";
  if (/iPad/i.test(ua)) return "an iPad";
  if (/iPhone/i.test(ua)) return "an iPhone";
  if (/Android/i.test(ua)) return "an Android device";
  if (/Macintosh|Mac OS X/i.test(ua)) return "a Mac";
  if (/Windows/i.test(ua)) return "a Windows PC";
  if (/Chrome/i.test(ua)) return "a Chrome browser";
  if (/Safari/i.test(ua)) return "a Safari browser";
  return "a device";
}

function publicProfile(user) {
  const role = userRole(user);
  return {
    id: user.id,
    email: user.email,
    name: user.data.profile.name,
    role,
    // Exposes the kid PROFILE id (distinct from this user id) so the client
    // can lock the kid switcher to this kid's own view. Omitted for parents.
    kidId: role === "kid" && user.data.kid ? user.data.kid.kidId : undefined,
    createdAt: user.createdAt,
  };
}

// ===================== AUTH: session =====================
app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.delete("/api/account", requireAuth, requireParent, (req, res) => {
  store.deleteUser(req.user.id);
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json({ user: publicProfile(user) });
});

// ===================== BILLING (Stripe) =====================
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

// ===================== HEALTH =====================
app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    build: BUILD_INFO.label,
    builtAt: BUILD_INFO.builtAt,
    commit: BUILD_INFO.commit,
    assetHash: BUILD,
    encryption: {
      keyConfigured: !!(process.env.DATA_ENCRYPTION_KEY || "").trim(),
      atRestEncrypted: db.isFileEncrypted(),
    },
    billing: {
      enabled: billing.enabled(),
      mode: /_live_/.test(process.env.STRIPE_SECRET_KEY || "") ? "live" : (/_test_/.test(process.env.STRIPE_SECRET_KEY || "") ? "test" : "none"),
      hasSecretKey: !!(process.env.STRIPE_SECRET_KEY || "").trim(),
      hasPriceId: !!(process.env.STRIPE_PRICE_ID || "").trim(),
      hasWebhookSecret: !!(process.env.STRIPE_WEBHOOK_SECRET || "").trim(),
    },
    push: {
      enabled: notifications.enabled(),
      webEnabled: notifications.webEnabled(),
      // Present only when a key was supplied but failed to load (bad .p8 / path).
      configError: notifications.configError() || undefined,
    },
  });
});

// ===================== ANALYTICS =====================
const TRACK_EVENTS = new Set(["pageview", "exposure", ...analytics.ALLOWED_EVENTS]);
function rawCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const m = header.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}
app.post("/api/track", (req, res) => {
  res.set("Cache-Control", "no-store");
  const body = req.body || {};
  const event = String(body.event || "");
  if (!TRACK_EVENTS.has(event)) return res.status(204).end();
  try {
    if (event === "pageview") {
      const day = analytics.today();
      const isNew = rawCookie(req, "fam_d") !== day;
      if (isNew) {
        res.cookie("fam_d", day, { maxAge: 2 * 24 * 60 * 60 * 1000, httpOnly: true, secure: IS_PROD, sameSite: "lax" });
      }
      analytics.recordPageview(body.path, isNew);
    } else if (event === "exposure") {
      analytics.recordExposure(body.exp, body.variant);
    } else {
      analytics.recordEvent(event);
    }
  } catch (e) { /* analytics must never surface an error to the client */ }
  res.status(204).end();
});
function requireAdmin(req, res, next) {
  const token = (process.env.ANALYTICS_TOKEN || "").trim();
  const provided = (req.get("x-analytics-token") || req.query.token || "").trim();
  if (token) {
    if (provided && provided === token) return next();
    res.set("Cache-Control", "no-store");
    return res.status(401).json({ error: "Unauthorized — provide the analytics token." });
  }
  const ip = req.ip || "";
  const local = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!IS_PROD && local) return next();
  res.set("Cache-Control", "no-store");
  return res.status(401).json({ error: "Analytics is locked — set ANALYTICS_TOKEN to enable the dashboard." });
}
app.get("/api/admin/analytics", requireAdmin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(analytics.summary(req.query.days));
});

// ===================== PASSKEYS (WebAuthn) — PARENTS ONLY =====================
// There is no kid signup path: every account created through these routes is
// a parent (see APP-BRIEF.md "Kids' privacy & compliance"). Kid profiles are
// created only via POST /api/family/kids by an already-signed-in parent.
function publicCredential(c) {
  return {
    id: c.id,
    name: c.name || "Passkey",
    createdAt: c.createdAt,
    lastUsed: c.lastUsed || null,
    deviceType: c.deviceType || null,
    backedUp: !!c.backedUp,
  };
}

app.post("/api/webauthn/register/options", authLimiter, requireAuth, async (req, res) => {
  const { rpID, rpName } = rpForRequest(req);
  const existing = store.listCredentials(req.user.id);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(req.user.id),
    userName: req.user.email,
    userDisplayName: req.user.data.profile.name || req.user.email,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  req.session.waReg = options.challenge;
  res.json(options);
});

app.post("/api/webauthn/register/verify", authLimiter, requireAuth, async (req, res) => {
  const expectedChallenge = req.session.waReg;
  req.session.waReg = undefined;
  if (!expectedChallenge) return res.status(400).json({ error: "Registration session expired — try again." });
  const { rpID, origins } = rpForRequest(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return res.status(400).json({ error: "Could not register this passkey. " + e.message });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: "Passkey registration could not be verified." });
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  if (store.findByCredentialId(credential.id)) {
    return res.status(409).json({ error: "That passkey is already registered." });
  }
  const label = (req.body && req.body.label ? String(req.body.label) : "").trim().slice(0, 60);
  store.addCredential(req.user.id, {
    id: credential.id,
    publicKey: toB64url(credential.publicKey),
    counter: credential.counter || 0,
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: label || (credentialDeviceType === "multiDevice" ? "Synced passkey" : "This device"),
    createdAt: new Date().toISOString(),
  });
  res.json({ verified: true, credentials: store.listCredentials(req.user.id).map(publicCredential) });
});

app.post("/api/webauthn/auth/options", authLimiter, async (req, res) => {
  const { rpID } = rpForRequest(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  req.session.waAuth = options.challenge;
  res.json(options);
});

app.post("/api/webauthn/auth/verify", authLimiter, async (req, res) => {
  const expectedChallenge = req.session.waAuth;
  req.session.waAuth = undefined;
  if (!expectedChallenge) return res.status(400).json({ error: "Sign-in session expired — try again." });
  const credId = req.body && req.body.id;
  const user = credId ? store.findByCredentialId(credId) : null;
  const cred = user && (user.credentials || []).find((c) => c.id === credId);
  if (!user || !cred) return res.status(401).json({ error: "Unrecognized passkey." });
  const { rpID, origins } = rpForRequest(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: fromB64url(cred.publicKey),
        counter: cred.counter || 0,
        transports: cred.transports || [],
      },
      requireUserVerification: true,
    });
  } catch (e) {
    return res.status(400).json({ error: "Passkey sign-in failed. " + e.message });
  }
  if (!verification.verified) return res.status(401).json({ error: "Passkey could not be verified." });
  store.updateCredentialCounter(cred.id, verification.authenticationInfo.newCounter);
  req.session.uid = user.id;
  res.json({ user: publicProfile(user) });
});

// PARENT-ONLY signup. No role parameter, no kid path — accepting one here
// would reopen the direct-kid-signup hole the brief explicitly closes.
app.post("/api/webauthn/signup/options", signupLimiter, async (req, res) => {
  if (currentUser(req)) return res.status(400).json({ error: "You're already signed in." });
  const { rpID, rpName } = rpForRequest(req);
  const newId = "u_" + crypto.randomBytes(9).toString("hex");
  const name = (req.body && req.body.name ? String(req.body.name) : "").trim().slice(0, 60);
  const displayName = name || "Fam ETC parent";
  const userName = name || "parent-" + newId.slice(2, 8);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(newId),
    userName,
    userDisplayName: displayName,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  req.session.waSignup = { challenge: options.challenge, userId: newId, name: displayName };
  res.json(options);
});

app.post("/api/webauthn/signup/verify", signupLimiter, async (req, res) => {
  const pending = req.session.waSignup;
  req.session.waSignup = undefined;
  if (!pending) return res.status(400).json({ error: "Sign-up session expired — start again." });
  const { rpID, origins } = rpForRequest(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: pending.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return res.status(400).json({ error: "Could not create your passkey. " + e.message });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: "Passkey could not be verified." });
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  if (store.findByCredentialId(credential.id)) {
    return res.status(409).json({ error: "That passkey is already in use. Try signing in instead." });
  }
  const user = store.createUser("", pending.name, {
    id: pending.userId,
    grandfathered: isIOSClient(req),
  });
  store.addCredential(user.id, {
    id: credential.id,
    publicKey: toB64url(credential.publicKey),
    counter: credential.counter || 0,
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: credentialDeviceType === "multiDevice" ? "Synced passkey" : "This device",
    createdAt: new Date().toISOString(),
  });
  req.session.uid = user.id;
  try { analytics.recordSignup(isIOSClient(req) ? "ios" : "web"); } catch (e) { /* never block signup */ }
  res.json({ user: publicProfile(user) });
});

app.get("/api/webauthn/credentials", requireAuth, (req, res) => {
  res.json({ credentials: store.listCredentials(req.user.id).map(publicCredential) });
});
app.patch("/api/webauthn/credentials/:id", requireAuth, (req, res) => {
  const creds = store.renameCredential(req.user.id, req.params.id, (req.body || {}).name);
  res.json({ credentials: creds.map(publicCredential) });
});
app.delete("/api/webauthn/credentials/:id", requireAuth, (req, res) => {
  const creds = store.removeCredential(req.user.id, req.params.id);
  res.json({ credentials: creds.map(publicCredential) });
});

// ----- backup-code account recovery -----
const BACKUP_GENERIC_ERR = "That code didn't match. Check it and try again.";
function findUserByBackupCode(code) {
  const root = db.load();
  for (const u of Object.values(root.users || {})) {
    if (!u.backupCodes) continue;
    const idx = backupCodes.matchIndex(u.backupCodes, code);
    if (idx >= 0) return { user: u, idx };
  }
  return null;
}
app.post("/api/auth/backup/verify", authLimiter, (req, res) => {
  if (currentUser(req)) return res.status(400).json({ error: "You're already signed in." });
  const code = (req.body && req.body.code) || "";
  if (backupCodes.normalize(code).length < 8) return res.status(400).json({ error: BACKUP_GENERIC_ERR });
  const hit = findUserByBackupCode(code);
  if (!hit) return res.status(401).json({ error: BACKUP_GENERIC_ERR });
  hit.user.backupCodes.codes[hit.idx].used = true;
  store.saveUser(hit.user);
  req.session.uid = hit.user.id;
  res.json({ user: publicProfile(hit.user) });
});
app.post("/api/auth/backup/issue", authLimiter, requireAuth, requireParent, (req, res) => {
  const user = req.user;
  if (user.backupCodes) return res.json({ issued: false });
  const set = backupCodes.generateSet();
  user.backupCodes = set.record;
  store.saveUser(user);
  res.json({ issued: true, backupCodes: set.plaintext });
});
app.post("/api/auth/backup/regenerate", authLimiter, requireAuth, requireParent, (req, res) => {
  const user = req.user;
  const set = backupCodes.generateSet();
  user.backupCodes = set.record;
  store.saveUser(user);
  res.json({ backupCodes: set.plaintext, remaining: set.plaintext.length });
});

// --- Kid side (public — the kid has no session yet; pollToken gates everything) ---
app.post("/api/kid/access-request", authLimiter, async (req, res) => {
  const { inviteCode, name, deviceLabel } = req.body || {};
  const label = String(deviceLabel || "").trim() || deviceLabelFromUA(req);
  const result = kidAccess.createRequest(inviteCode, name, label);
  if (result.error) return res.status(400).json({ error: result.error });
  // Ping every parent so they can approve — never block the kid's response on it.
  notifications
    .notifyKidAccessRequest({
      familyParentIds: result.family.parentIds,
      name: result.request.name,
      deviceLabel: result.request.deviceLabel,
      familyId: result.family.id,
    })
    .catch((e) => console.error("[kid-access] notify error:", e.message));
  res.json({ requestId: result.request.id, pollToken: result.request.pollToken, name: result.request.name });
});
app.get("/api/kid/access-request/:id", apiLimiter, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(kidAccess.statusForKid(req.params.id, String(req.query.token || "")));
});
app.post("/api/kid/access-request/:id/register/options", authLimiter, async (req, res) => {
  const token = String((req.body || {}).token || "");
  const request = kidAccess.getApproved(req.params.id, token);
  if (!request) return res.status(400).json({ error: "This request isn't approved yet (or has expired)." });
  const fam = family.getFamily(request.familyId);
  const kidProfile = fam && fam.kids.find((k) => k.id === request.kidId);
  if (!kidProfile) return res.status(400).json({ error: "That kid profile is no longer available." });
  const kidUser = store.findOrCreateKidUser(request.familyId, request.kidId, kidProfile.name);
  const { rpID, rpName } = rpForRequest(req);
  const existing = store.listCredentials(kidUser.id);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(kidUser.id),
    userName: kidProfile.name || "kid-" + kidUser.id.slice(2, 8),
    userDisplayName: kidProfile.name || "Fam ETC kid",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  kidAccess.setRegistration(req.params.id, token, options.challenge, kidUser.id);
  res.json(options);
});
app.post("/api/kid/access-request/:id/register/verify", authLimiter, async (req, res) => {
  const token = String((req.body || {}).token || "");
  const request = kidAccess.getApproved(req.params.id, token);
  if (!request || !request.regChallenge || !request.kidUserId) {
    return res.status(400).json({ error: "Device setup expired — start again." });
  }
  const { rpID, origins } = rpForRequest(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body.response || req.body,
      expectedChallenge: request.regChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return res.status(400).json({ error: "Could not set up this device. " + e.message });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: "Device passkey could not be verified." });
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  if (store.findByCredentialId(credential.id)) {
    return res.status(409).json({ error: "That passkey is already registered." });
  }
  store.addCredential(request.kidUserId, {
    id: credential.id,
    publicKey: toB64url(credential.publicKey),
    counter: credential.counter || 0,
    transports: credential.transports || [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: "This device",
    createdAt: new Date().toISOString(),
  });
  kidAccess.complete(req.params.id, token);
  // Sign the kid in on THIS device — the whole point: no parent session needed.
  req.session.uid = request.kidUserId;
  const kidUser = store.getUser(request.kidUserId);
  res.json({ user: publicProfile(kidUser) });
});

// ===================== HOMEWORK (Phase 3) =====================
// Family/kid-scoped homework hub. Ownership is enforced here (never trusted
// from the request body): a kid session may only list/add/edit/delete their
// OWN homework (kidId derived from req.user.data.kid.kidId), a parent may
// touch any homework in their family. See lib/homework.js canAccess().
// kidIdForUser/friendlyDate are shared helpers (also used by calendar/notes/
// wordbank/brainteaser routes) — defined once here, passed via routeDeps.
function kidIdForUser(req) {
  return req.user && req.user.data && req.user.data.kid && req.user.data.kid.kidId;
}
function friendlyDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return String(ymd || "");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// Shared deps for extracted route modules under lib/routes/ (see that
// directory's README-equivalent comment in server.js history / commit log).
// Each module destructures only what it uses.
const routeDeps = {
  store, db, billing, backupCodes, analytics, family, chat, kidAccess, events, gifs,
  schoolFeeds, homework, notes, wordbank, brainteaser, schoolAccount, moodleClient, notifications,
  requireAuth, requireParent, requireFamily, requireAdmin,
  apiLimiter, gifLimiter, authLimiter, signupLimiter,
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
  rpForRequest, toB64url, fromB64url, upload, crypto,
  userRole, kidIdForUser, friendlyDate, isIOSClient, deviceLabelFromUA, publicProfile, publicCredential,
  currentUser, rateLimit, envNum,
};
require("./lib/routes/family")(app, routeDeps);
require("./lib/routes/chat")(app, routeDeps);
require("./lib/routes/calendar")(app, routeDeps);
require("./lib/routes/homework")(app, routeDeps);
require("./lib/routes/learning")(app, routeDeps);
require("./lib/routes/school")(app, routeDeps);

// ===================== PUSH: device token registration =====================
app.post("/api/push/register", requireAuth, (req, res) => {
  const token = (req.body || {}).token;
  if (!token) return res.status(400).json({ error: "Missing device token." });
  notifications.registerToken(req.user.id, token);
  res.json({ ok: true });
});
app.post("/api/push/unregister", requireAuth, (req, res) => {
  const token = (req.body || {}).token;
  if (token) notifications.removeToken(req.user.id, token);
  res.json({ ok: true });
});

// ===================== PUSH: web subscription registration =====================
// Public key only — not secret, the browser needs it to call
// pushManager.subscribe({ applicationServerKey: ... }). requireAuth just
// keeps this off anonymous scraping; it's not sensitive.
app.get("/api/push/vapid-public-key", requireAuth, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});
app.post("/api/push/web/subscribe", requireAuth, (req, res) => {
  const subscription = (req.body || {}).subscription;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: "Missing subscription." });
  notifications.addWebSubscription(req.user.id, subscription);
  res.json({ ok: true });
});
app.post("/api/push/web/unsubscribe", requireAuth, (req, res) => {
  const endpoint = (req.body || {}).endpoint;
  if (endpoint) notifications.removeWebSubscription(req.user.id, endpoint);
  res.json({ ok: true });
});

// ===================== PUSH: notify self =====================
// "Notify myself" path for client-side change/threshold detection (school
// stats: attendance change, low canteen balance) that can't wait for a
// server-side cron — the browser tab that ran the detection asks the server
// to push to ITS OWN user's stored web subscriptions. requireParent because
// today only the parent-facing school stats widget calls this; requireAuth
// alone would also be safe (sendWebToUser is always scoped to req.user.id —
// there is no way to target another user's subscriptions via this route).
const notifySelfLimiter = rateLimit({ windowMs: 60 * 1000, max: envNum("RL_NOTIFY_SELF_MAX", 30), message: "Too many notifications requested — please wait a moment." });
app.post("/api/notify/self", requireAuth, requireParent, notifySelfLimiter, async (req, res) => {
  const { title, body, tag } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: "Missing title." });
  if (!notifications.webEnabled()) return res.json({ sent: 0 });
  try {
    const payload = {
      title: String(title).slice(0, 200),
      body: body ? String(body).slice(0, 500) : "",
      data: { url: "/", famType: "self_notify", tag: tag || undefined },
    };
    const result = await notifications.sendWebToUser(req.user.id, payload, { urgency: "normal" });
    res.json({ sent: result.sent || 0 });
  } catch (e) {
    // Never let a push-delivery hiccup surface as a hard error to the caller
    // — this is a best-effort notify path.
    res.json({ sent: 0 });
  }
});

// ===================== UPLOADS =====================
// Timetable/homework photo uploads (JPG/PNG/PDF). Parsing itself happens
// client-side via the existing Claude pipeline (see app.js) — this endpoint
// exists for the iOS scanner path where a native upload is simplest.
app.post("/api/uploads", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });
  // Scaffold: echoes size/type only. Wire to storage + parse pipeline as the
  // homework-hub feature (FEATURE_PLAN.md Phase 3) is built out.
  res.json({ ok: true, filename: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype });
});

// ===================== PAGES =====================
const IMMUTABLE = "public, max-age=31536000, immutable";
app.use("/css", express.static(path.join(PUBLIC, "css"), { setHeaders: (res) => res.setHeader("Cache-Control", IMMUTABLE) }));
app.use("/js/vendor", express.static(path.join(PUBLIC, "js", "vendor"), { setHeaders: (res) => res.setHeader("Cache-Control", IMMUTABLE) }));
const jsCache = new Map();
app.get(/^\/js\/([\w.-]+\.js)$/, (req, res, next) => {
  const file = req.params[0];
  if (!jsCache.has(file)) {
    try {
      jsCache.set(file, fs.readFileSync(path.join(PUBLIC, "js", file), "utf8"));
    } catch (e) {
      jsCache.set(file, null);
    }
  }
  const body = jsCache.get(file);
  if (body == null) return next();
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache"); // revalidate — app.js changes every deploy
  res.send(body);
});
// Service worker MUST be served at root scope ("/sw.js", not "/js/sw.js")
// so its registration (navigator.serviceWorker.register('/sw.js')) covers
// the whole app. no-cache (not immutable) so a redeploy's changes reach
// clients on their next visit rather than being pinned by a stale SW.
app.get("/sw.js", (req, res) => {
  res.type("application/javascript; charset=utf-8").setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(PUBLIC, "sw.js"));
});
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").setHeader("Cache-Control", "public, max-age=86400");
  res.send(`User-agent: *\nAllow: /\n\nSitemap: ${CANONICAL_HOST}/sitemap.xml\n`);
});
app.get("/sitemap.xml", (req, res) => {
  const SITEMAP_PATHS = ["/", "/pricing", "/help", "/privacy", "/terms"];
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${CANONICAL_HOST}${p}</loc></url>`).join("\n");
  res.type("application/xml").setHeader("Cache-Control", "public, max-age=86400");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

const pageCache = new Map();
const sendPage = (req, res, file, opts = {}) => {
  if (!pageCache.has(file)) {
    try {
      const html = fs.readFileSync(path.join(PUBLIC, file), "utf8")
        .replace(/\/css\/styles\.css/g, `/css/styles.css?v=${BUILD}`)
        .replace(/\/js\/school-stats\.js/g, `/js/school-stats.js?v=${BUILD}`)
        .replace(/\/js\/auth\.js/g, `/js/auth.js?v=${BUILD}`)
        .replace(/\/js\/app\.js/g, `/js/app.js?v=${BUILD}`);
      pageCache.set(file, html);
    } catch (e) {
      pageCache.set(file, null);
    }
  }
  const html = pageCache.get(file);
  if (html == null) return res.status(404).end();
  const canonical = CANONICAL_HOST + (req.path === "/" ? "/" : req.path);
  const head = `  <link rel="canonical" href="${canonical}" />\n</head>`;
  const out = html.replace("</head>", head);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // ANY auth-dependent route (incl. "/") must stay private — s-maxage on these
  // would serve the cached anonymous page to logged-in users (LiteSpeed edge
  // cache gotcha, see skill reference/server.md).
  res.setHeader("Cache-Control", opts.public ? "public, max-age=0, s-maxage=300, stale-while-revalidate=60" : "private, max-age=0, must-revalidate");
  res.setHeader("Vary", "Cookie");
  res.send(out);
};
const PUB = { public: true };

const safeNext = (next) => (typeof next === "string" && /^\/[^/\\]/.test(next) ? next : "/");
app.get("/login", (req, res) => {
  if (currentUser(req)) return res.redirect(safeNext(req.query.next));
  sendPage(req, res, "login.html");
});
app.get("/signup", (req, res) => {
  if (currentUser(req)) return res.redirect(safeNext(req.query.next));
  sendPage(req, res, "signup.html");
});
app.get("/privacy", (req, res) => sendPage(req, res, "privacy.html", PUB));
app.get("/terms", (req, res) => sendPage(req, res, "terms.html", PUB));
app.get("/pricing", (req, res) => sendPage(req, res, "pricing.html", PUB));
app.get("/help", (req, res) => sendPage(req, res, "help.html", PUB));
app.get("/security", requireAuth, (req, res) => sendPage(req, res, "security.html"));
app.get("/billing", requireAuth, requireParent, (req, res) => sendPage(req, res, "billing.html"));
app.get("/", (req, res) => {
  if (!currentUser(req)) return sendPage(req, res, "landing.html", PUB);
  sendPage(req, res, "index.html");
});
app.get("/favicon.ico", (req, res) => res.status(204).end());

// SPA fallback for authenticated app routes (goals/activities/settings live
// in the same shell — see HybridWebView tabs in the iOS brief).
app.get(["/app", "/app/*", "/goals", "/activities", "/settings"], requireAuth, (req, res) => {
  sendPage(req, res, "index.html");
});

const listenTarget = process.env.SOCKET_PATH || PORT;
const server = app.listen(listenTarget, () => {
  console.log(`Fam ETC server listening on ${listenTarget} (build ${BUILD_INFO.label}${BUILD_INFO.builtAt ? " @ " + BUILD_INFO.builtAt : ""}, assets ${BUILD})`);
});

// Tests require this module directly and need the bound `server` (e.g. to
// read its ephemeral port when PORT=0, and to close() it when done) — `app`
// alone doesn't expose the listening socket. Production entry (`npm start`)
// only ever uses the side effect of app.listen() above.
module.exports = app;
module.exports.server = server;
