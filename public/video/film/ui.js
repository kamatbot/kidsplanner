// Fam ETC app screens (Family Rings), drawn crisp inside the film's painted phone.
// Layout, copy and colours follow reference shots of the real web app at 390×844 (headless Chrome @3x,
// seeded fictional family) and the --fr-* tokens in Planner/public/css/horizon.css. The film's family is
// the Walkers: Kate and Tom (parents), Mia and Leo. Hermes is left out (closed beta, off by default).
// Every screen paints in CSS px on a 390×844 viewport with an iOS status bar on top; page content scrolls
// by s.scroll. Screens return hit points {name: [x, y]} in CSS px for the film's tap rings and cards.
export const SCREEN = { w: 390, h: 844 };
const FR = {
  bg: "#F4F5F7", card: "#FFFFFF", card2: "#F7F8FA", rule: "#E7E9EE", ink: "#15171C", ink2: "#6B7280", ink3: "#9CA3AF",
  you: "#7B4DFF", youInk: "#5B2EE6", youSoft: "#EFEAFF", hw: "#EF6A12", hwInk: "#C2410C", hwSoft: "#FFEDD5",
  famsInk: "#8A5A00", famsSoft: "#FFF3D6", green: "#16824F", teal: "#0D9488", amber: "#F59E0B",
  kidBubble: "#FEF5E7", kateAv: "#E6EDFE", tomAv: "#EDE6FF", toast: "#15171C",
};
const SB = 47; // status bar height; the web app sits below it
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const eo = (t) => 1 - (1 - clamp(t)) ** 3;
const font = (px, w = 400) => `${w} ${px}px Geist`;
const dpr = (g) => Math.hypot(g.getTransform().a, g.getTransform().b); // shadows are in device px

function text(g, s, x, y, { px = 15, w = 400, color = FR.ink, align = "left", ls = 0, alpha = 1 } = {}) {
  if (alpha <= 0) return 0;
  g.save();
  g.font = font(px, w); g.fillStyle = color; g.textAlign = align; g.textBaseline = "alphabetic"; g.globalAlpha *= alpha;
  if (ls) g.letterSpacing = `${ls}px`;
  g.fillText(s, x, y);
  const wd = g.measureText(s).width;
  g.restore();
  return wd;
}
function measure(g, s, px, w = 400, ls = 0) { g.save(); g.font = font(px, w); if (ls) g.letterSpacing = `${ls}px`; const m = g.measureText(s).width; g.restore(); return m; }
function rr(g, x, y, w, h, r, fill, stroke, lw = 1) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function card(g, x, y, w, h, r = 20) { // --fr-shadow: 0 1px 2px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.06)
  const k = dpr(g);
  g.save();
  g.shadowColor = "rgba(16,24,40,0.07)"; g.shadowBlur = 24 * k; g.shadowOffsetY = 8 * k; rr(g, x, y, w, h, r, FR.card);
  g.shadowColor = "rgba(16,24,40,0.06)"; g.shadowBlur = 2 * k; g.shadowOffsetY = 1 * k; rr(g, x, y, w, h, r, FR.card);
  g.restore();
}
function avatar(g, x, y, r, letter, bg, fg, ring = 0) {
  if (ring) { g.beginPath(); g.arc(x, y, r + ring, 0, 6.283); g.fillStyle = "#fff"; g.fill(); }
  g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = bg; g.fill();
  text(g, letter, x, y + r * 0.36, { px: r * 0.95, w: 700, color: fg, align: "center" });
}
function icon(g, name, x, y, s, color, lw = 1.8) { // line icons on a 24px grid, round caps (TODAY_ICONS style)
  g.save(); g.translate(x - 12 * s, y - 12 * s); g.scale(s, s);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = lw; g.lineCap = "round"; g.lineJoin = "round";
  const P = new Path2D({
    sun: "M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    cal: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4",
    book: "M5 4h14v16l-7-4-7 4z",
    target: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8",
    dots: "M5 12h.01M12 12h.01M19 12h.01",
    send: "M5 12h13M13 6l6 6-6 6",
    chat: "M4 12a8 8 0 1 1 3.3 6.5L4 20l1.3-3.6A8 8 0 0 1 4 12z",
    clip: "M20 11.5l-8.2 8.2a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8",
    check: "M5 12.5l4.5 4.5L19 7.5",
    pencil: "M4 20l4-1 11-11-3-3L5 16z",
    x: "M6 6l12 12M18 6L6 18",
    chev: "M9 6l6 6-6 6",
    down: "M6 9l6 6 6-6",
    camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7",
  }[name]);
  if (name === "dots") { g.lineWidth = 3.2; }
  g.stroke(P);
  g.restore();
}
function status(g, time) { // iOS status bar over whatever scrolls beneath it
  g.fillStyle = FR.bg; g.fillRect(0, 0, 390, SB);
  text(g, time, 52, 32, { px: 16, w: 600, align: "center", ls: -0.2 });
  g.fillStyle = FR.ink;
  [4, 6.5, 9, 11.5].forEach((h, i) => rr(g, 290 + i * 5, 32 - h, 3.2, h, 1, FR.ink));
  g.save(); g.strokeStyle = FR.ink; g.lineWidth = 2; g.lineCap = "round";
  [[8, 0.75], [5, 0.75], [2, 0.75]].forEach(([r]) => { g.beginPath(); g.arc(320, 31, r + 1.5, -Math.PI * 0.75, -Math.PI * 0.25); g.stroke(); });
  g.restore();
  rr(g, 334, 22, 25, 12, 3.5, null, "rgba(21,23,28,0.45)", 1.2); rr(g, 336, 24, 19, 8, 2, FR.ink); rr(g, 360, 26, 2, 4, 1, "rgba(21,23,28,0.45)");
}
function brandBar(g, y, letter, avBg, avFg = "#fff") { // "F Fam ETC" + profile avatar (phone header)
  rr(g, 16, y, 28, 28, 7, FR.you);
  text(g, "F", 30, y + 20, { px: 16, w: 700, color: "#fff", align: "center" });
  text(g, "Fam ETC", 54, y + 20, { px: 18, w: 600, ls: -0.2 });
  avatar(g, 356, y + 14, 17, letter, avBg, avFg);
}
function bottomNav(g, active) {
  g.fillStyle = FR.card; g.fillRect(0, 768, 390, 76);
  g.fillStyle = FR.rule; g.fillRect(0, 768, 390, 1);
  [["Today", "sun"], ["Calendar", "cal"], ["Homework", "book"], ["Goals", "target"], ["More", "dots"]].forEach(([label, ic], i) => {
    const x = 42 + i * 76.5, on = label === active, c = on ? FR.you : FR.ink2;
    icon(g, ic, x, 797, 0.85, c);
    text(g, label, x, 822, { px: 12, w: on ? 600 : 500, color: c, align: "center" });
  });
}
function wrapText(g, s, px, w, maxW) {
  const words = s.split(" "), out = []; let cur = "";
  for (const wd of words) { const t = cur ? `${cur} ${wd}` : wd; if (measure(g, t, px, w) > maxW && cur) { out.push(cur); cur = wd; } else cur = t; }
  out.push(cur);
  return out;
}
function toast(g, label, u) { // the app's dark toast, bottom right of centre as in the real layout
  if (u <= 0) return null;
  const k = eo(u), w = Math.max(242, measure(g, label, 15, 500) + 44), x = 365 - w, y = 773 + (1 - k) * 14;
  g.save(); g.globalAlpha *= k;
  const d = dpr(g); g.shadowColor = "rgba(0,0,0,0.18)"; g.shadowBlur = 16 * d; g.shadowOffsetY = 6 * d;
  rr(g, x, y, w, 46, 23, FR.toast);
  g.restore();
  text(g, label, x + w / 2, y + 29, { px: 15, w: 500, color: "#fff", align: "center", alpha: k });
  return [x + w / 2, y + 23];
}

// ───────────────────────────── chat (Kate's phone): Today behind the family-chat slide-over ─────────────────────────────
const MSGS = [
  { who: "Leo", letter: "L", kid: true, text: "Can someone bring my goggles?", time: "4:58 PM" },
  { who: "Kate", own: true, text: "In the swim bag 🏊", time: "5:00 PM" },
  { who: "Tom", letter: "T", text: "Heading past the shops. Need anything?", time: "5:05 PM" },
  { who: "Kate", own: true, text: "pasta, tomatoes, basil", time: "5:07 PM" },
];
function msgBlock(g, m, top, alpha, actions, hits, idx) {
  g.save(); g.globalAlpha *= alpha;
  if (m.own) {
    const bw = measure(g, m.text, 14) + 28, bx = 320 - bw;
    rr(g, bx, top, bw, 38, 16, FR.youSoft);
    text(g, m.text, bx + 14, top + 24, { px: 14, color: FR.youInk });
    avatar(g, 342, top + 14, 12, "K", FR.kateAv, FR.youInk);
    const x0 = 124.3;
    text(g, m.time, x0 + 4, top + 58, { px: 10, color: FR.ink2 });
    if (actions > 0) {
      g.save(); g.globalAlpha *= actions;
      text(g, "⊕", x0 + 58, top + 61, { px: 18, w: 700, color: FR.you, align: "center" });
      text(g, "📅", x0 + 90, top + 60, { px: 16, align: "center" });
      text(g, "🛒", x0 + 122, top + 60, { px: 16, align: "center" });
      g.restore();
      hits[`cart${idx}`] = [x0 + 122, top + 54];
    }
    hits[`msg${idx}`] = [bx + bw / 2, top + 19];
  } else {
    avatar(g, 48, top + 12, 12, m.letter, m.kid ? FR.amber : FR.tomAv, m.kid ? "#fff" : FR.youInk);
    text(g, m.who, 75, top + 11, { px: 11, w: 600, color: m.kid ? FR.ink : FR.you });
    const bw = measure(g, m.text, 14) + 28;
    rr(g, 75, top + 17, bw, 38, 16, m.kid ? FR.kidBubble : FR.card2);
    text(g, m.text, 89, top + 41, { px: 14 });
    text(g, m.time, 79, top + 75, { px: 10, color: FR.ink2 });
  }
  g.restore();
}
export function chat(g, s) {
  const hits = {};
  g.fillStyle = FR.bg; g.fillRect(0, 0, 390, 844);
  const o = SB;
  brandBar(g, o + 14, "K", FR.you);
  text(g, "Good evening, Kate", 17, o + 101, { px: 30, w: 700, ls: -0.6 });
  wrapText(g, "Wednesday 30 September · Nothing overdue · 2 events today", 15, 400, 356).forEach((l, i) => text(g, l, 17, o + 128 + i * 21, { px: 15, color: FR.ink2 }));
  // the family-chat slide-over
  const cy = o + 174;
  card(g, 17, cy, 356, 514, 24);
  rr(g, 37, cy + 18, 66, 32, 16, FR.youSoft);
  text(g, "Family", 70, cy + 39, { px: 13, w: 600, color: FR.youInk, align: "center" });
  [["K", FR.kateAv, FR.youInk], ["T", FR.tomAv, FR.youInk], ["M", FR.teal, "#fff"], ["L", FR.amber, "#fff"]].forEach(([l, bg, fg], i) => avatar(g, 280 + i * 22, cy + 34, 13, l, bg, fg, 2));
  g.fillStyle = FR.rule; g.fillRect(17, cy + 65, 356, 1);
  g.save(); g.beginPath(); g.rect(17, cy + 66, 356, 319); g.clip();
  const ws = [1, 1, eo(s.tom), eo(s.sent)];
  let cursor = o + 590;
  for (let i = MSGS.length - 1; i >= 0; i--) {
    const w = ws[i];
    if (w <= 0) continue;
    const m = MSGS[i], h = m.own ? 68.6 : 84.6, top = cursor - h;
    msgBlock(g, m, top + (1 - w) * 18, w, i === 3 ? clamp(s.actions ?? 0) : 0, hits, i);
    cursor -= (h + 12) * w;
  }
  g.restore();
  // composer
  const iy = o + 574;
  rr(g, 37, iy, 267, 42, 21, "#fff", FR.rule, 1);
  const draft = "pasta, tomatoes, basil", n = Math.round(draft.length * clamp(s.typed)) * (s.sent > 0 ? 0 : 1);
  if (n > 0) {
    const tw = text(g, draft.slice(0, n), 57, iy + 26, { px: 15 });
    if (Math.floor((s.t ?? 0) * 2.5) % 2 === 0 || s.typed < 1) { g.fillStyle = FR.you; g.fillRect(58 + tw, iy + 11, 1.6, 20); }
  } else text(g, "Message the family…", 57, iy + 26, { px: 15, color: FR.ink3 });
  const sendDown = s.sent > 0 && s.sent < 0.5 ? 1 : 0;
  avatar(g, 336, iy + 21, 22, "", sendDown ? FR.youInk : FR.you, "#fff");
  icon(g, "send", 336, iy + 21, 0.85, "#fff", 2.2);
  [[53, "😀"], [107, "GIF"], [158, ""]].forEach(([x, l]) => {
    rr(g, x - 22, o + 623, 44, 44, 22, "#fff", FR.rule, 1);
    if (l === "GIF") text(g, "GIF", x, o + 650, { px: 12, w: 700, align: "center" });
    else if (l) text(g, l, x, o + 651, { px: 18, align: "center" });
    else icon(g, "clip", x, o + 645, 0.8, FR.ink2);
  });
  avatar(g, 345, 724, 28, "", FR.you, "#fff");
  icon(g, "chat", 345, 724, 0.95, "#fff", 2);
  bottomNav(g, "Today");
  // Add to Shopping (the real confirm dialog, prefilled from the message)
  const m = clamp(s.sheet ?? 0);
  if (m > 0) {
    g.fillStyle = `rgba(0,0,0,${0.5 * m})`; g.fillRect(0, 0, 390, 844);
    const k = eo(m), my = o + 167 + (1 - k) * 22;
    g.save(); g.globalAlpha *= k;
    g.translate(195, my + 231); g.scale(0.96 + 0.04 * k, 0.96 + 0.04 * k); g.translate(-195, -(my + 231));
    rr(g, 19.5, my, 351, 463, 24, "#fff");
    text(g, "🛒", 49, my + 48, { px: 19, align: "center" });
    text(g, "Add to Shopping", 64, my + 48, { px: 21, w: 700, ls: -0.3 });
    rr(g, 312, my + 25, 32, 32, 16, FR.card2);
    icon(g, "x", 328, my + 41, 0.55, FR.ink2, 2.4);
    text(g, "Confirm the item before adding it for the", 39, my + 90, { px: 16, color: FR.ink2 });
    text(g, "family.", 39, my + 111, { px: 16, color: FR.ink2 });
    const field = (label, y, value, sel) => {
      text(g, label, 39, y, { px: 12, w: 600, color: FR.ink2, ls: 0.9 });
      rr(g, 39, y + 11, 312, 42, 12, "#fff", FR.rule, 1);
      if (sel) { rr(g, 55, y + 20, measure(g, value, 16) + 6, 24, 3, "#E4E4E7"); }
      text(g, value, 58, y + 38, { px: 16 });
      if (!sel) icon(g, "down", 330, y + 32, 0.6, FR.ink2, 2);
    };
    field("ITEM *", my + 139, "pasta, tomatoes, basil", true);
    field("CATEGORY", my + 218, "Other");
    field("ASSIGN TO", my + 309, "Tom");
    const aw = measure(g, "Add item 🛒", 16, 600) + 44, ax = 343.5 - aw, cw = measure(g, "Cancel", 16, 600) + 44, cx = ax - 10 - cw;
    rr(g, cx, my + 396, cw, 42, 21, "#fff", FR.you, 1.5);
    text(g, "Cancel", cx + cw / 2, my + 423, { px: 16, w: 600, align: "center" });
    rr(g, ax, my + 396, aw, 42, 21, (s.addDown ?? 0) > 0.5 ? FR.youInk : FR.you);
    text(g, "Add item 🛒", ax + aw / 2, my + 423, { px: 16, w: 600, color: "#fff", align: "center" });
    g.restore();
    hits.add = [ax + aw / 2, my + 417];
  }
  const tp = toast(g, "Added to the shopping list. 🛒", s.toast ?? 0);
  if (tp) hits.toast = tp;
  status(g, "5:07");
  return hits;
}

// ───────────────────────────── shopping list (Tom's phone): Meals → Shopping ─────────────────────────────
const ITEMS = [["Milk", "Dairy"], ["Rice", "Grain"], ["Bananas", "Produce"], ["pasta, tomatoes, basil", "Other", "T"]];
export function shopping(g, s) {
  const hits = {}, y = (py) => py + SB - (s.scroll ?? 0), tick = clamp(s.tick ?? 0);
  g.fillStyle = FR.bg; g.fillRect(0, 0, 390, 844);
  text(g, "Meals", 14, y(40), { px: 26, w: 700, ls: -0.5 });
  rr(g, 269, y(12), 107, 39, 19.5, "#fff", FR.ink, 1.5);
  text(g, "Household", 322.5, y(37), { px: 15, w: 600, align: "center" });
  [["Tonight", 20], ["Menu", 100], ["Pantry", 180], ["Shopping", 262], ["Recipes", 350]].forEach(([l, x]) => text(g, l, x, y(86), { px: 15, w: 500, color: l === "Shopping" ? FR.you : FR.ink2 }));
  g.fillStyle = FR.you; g.fillRect(257, y(98), 83, 2.5);
  text(g, "Shopping list", 14, y(140), { px: 22, w: 700, ls: -0.3 });
  text(g, `${tick > 0.5 ? 1 : 0}/4 done`, 14, y(160), { px: 14, color: FR.ink2 });
  if (tick > 0) { // the real "Restock pantry" action appears once something is ticked
    g.save(); g.globalAlpha *= eo(tick);
    rr(g, 217, y(120), 159, 40, 20, "#fff", FR.you, 1.5);
    text(g, "🎉 Restock pantry", 296.5, y(145), { px: 15, w: 600, align: "center" });
    g.restore();
  }
  let x = 14;
  [["All", 1], ["Produce"], ["Protein"], ["Dairy"], ["Grain"]].forEach(([l, on]) => { const w = measure(g, l, 12, 500) + 26; rr(g, x, y(177), w, 26, 13, on ? FR.youSoft : "#fff", on ? FR.you : FR.rule, 1); text(g, l, x + w / 2, y(194), { px: 12, w: 500, color: on ? FR.youInk : FR.ink2, align: "center" }); x += w + 8; });
  x = 14;
  ["Pantry", "Frozen", "Spice", "Other"].forEach((l) => { const w = measure(g, l, 12, 500) + 26; rr(g, x, y(208), w, 26, 13, "#fff", FR.rule, 1); text(g, l, x + w / 2, y(225), { px: 12, w: 500, color: FR.ink2, align: "center" }); x += w + 8; });
  rr(g, 14, y(250), 193, 36, 10, "#fff", FR.rule, 1); text(g, "Add an item…", 26, y(273), { px: 15, color: FR.ink3 });
  rr(g, 217, y(250), 159, 36, 10, "#fff", FR.rule, 1); text(g, "Category", 229, y(273), { px: 15 }); icon(g, "down", 360, y(268), 0.55, FR.ink, 2.2);
  rr(g, 14, y(295), 70, 39, 19.5, FR.you); text(g, "Add", 49, y(320), { px: 15, w: 600, color: "#fff", align: "center" });
  ITEMS.forEach(([label, cat, who], i) => {
    const top = 355 + i * 69, done = i === 3 ? tick : 0, down = i === 3 ? clamp(s.down ?? 0) : 0;
    const bx = 17, by = y(top + 5);
    rr(g, bx, by, 18, 18, 4, done > 0.5 ? FR.you : "#fff", done > 0.5 ? FR.you : "#9CA3AF", 1.5);
    if (down > 0) { g.save(); g.globalAlpha *= 0.25 * down; g.beginPath(); g.arc(bx + 9, by + 9, 18, 0, 6.283); g.fillStyle = FR.you; g.fill(); g.restore(); }
    if (done > 0.5) icon(g, "check", bx + 9, by + 9, 0.6, "#fff", 3.2);
    const tw = text(g, label, 44, y(top + 19), { px: 16, color: done > 0.5 ? FR.ink3 : FR.ink });
    if (done > 0) { g.fillStyle = FR.ink3; g.fillRect(44, y(top + 13), tw * eo((done - 0.4) / 0.6), 1.5); }
    const tagW = measure(g, cat, 11, 500) + 16;
    rr(g, 18, y(top + 33), tagW, 20, 10, FR.famsSoft); text(g, cat, 18 + tagW / 2, y(top + 47), { px: 11, w: 500, color: FR.famsInk, align: "center" });
    const ax0 = 18 + tagW + 14;
    [["K", FR.you], ["T", FR.you], ["M", FR.teal], ["L", FR.amber]].forEach(([l, c], j) => {
      const cx = ax0 + j * 22, cy = y(top + 43), hl = who === l;
      g.beginPath(); g.arc(cx, cy, 9, 0, 6.283); g.fillStyle = hl ? FR.youSoft : "#fff"; g.fill();
      g.lineWidth = hl ? 2.2 : 1.2; g.strokeStyle = hl ? FR.ink : c; g.stroke();
      text(g, l, cx, cy + 3.5, { px: 9, w: 700, color: hl ? FR.ink : c, align: "center" });
    });
    if (i === 3 && done > 0.5) { const cx = ax0 + 4 * 22 + 6; g.beginPath(); g.arc(cx, y(top + 43), 9, 0, 6.283); g.fillStyle = "#fff"; g.fill(); g.lineWidth = 2; g.strokeStyle = FR.teal; g.stroke(); text(g, "T", cx, y(top + 46.5), { px: 9, w: 700, color: FR.teal, align: "center" }); }
    icon(g, "pencil", ax0 + 4 * 22 + (i === 3 && done > 0.5 ? 38 : 24), y(top + 43), 0.62, FR.ink2, 1.8);
    icon(g, "x", ax0 + 4 * 22 + (i === 3 && done > 0.5 ? 70 : 56), y(top + 43), 0.55, FR.ink2, 2);
    g.fillStyle = FR.rule; g.fillRect(14, y(top + 62), 362, 1);
    if (i === 3) { hits.check = [bx + 9, by + 9]; hits.item = [44 + tw / 2, y(top + 14)]; }
  });
  status(g, "5:21");
  return hits;
}

// ───────────────────────────── homework (Kate's view, then Mia's) ─────────────────────────────
const HW = [ // due groups as the app titles them (homeworkDateHeading); the film's day is Wednesday 30 September
  { title: "Fractions worksheet", subject: "Maths", kid: "Mia", mins: 20, group: 0 },
  { title: "Reading log", subject: "English", kid: "Mia", mins: 15, group: 0 },
  { title: "Vocabulary set 4", subject: "French", kid: "Leo", mins: 15, group: 0 },
  { title: "Volcano diagram", subject: "Science", kid: "Mia", mins: 45, group: 1 },
  { title: "Food chains poster", subject: "Science", kid: "Leo", mins: 40, group: 2 },
];
const GROUPS = ["Tomorrow", "Friday, Oct 2", "Monday, Oct 5"];
const KID = { Mia: ["M", FR.teal], Leo: ["L", FR.amber] };
function ring(g, x, y, r, frac, sw = 6) { // homework ring: 15 % track, orange arc from twelve o'clock, round caps
  g.save();
  g.lineWidth = sw; g.strokeStyle = "rgba(239,106,18,0.15)"; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.stroke();
  if (frac > 0.001) { g.lineCap = "round"; g.strokeStyle = FR.hw; g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + frac * 6.283); g.stroke(); }
  g.restore();
}
function kidRingCard(g, y, name, left, frac, w = 184) {
  card(g, 17, y, w, 78, 24);
  ring(g, 57, y + 39, 20, frac);
  text(g, name, 95, y + 34, { px: 17, w: 700 });
  text(g, `${left} left this week`, 95, y + 55, { px: 13, color: FR.hwInk });
}
function hwRow(g, it, y, { selected = false, kidView = false, check = 0, down = 0, alpha = 1 } = {}) {
  g.save(); g.globalAlpha *= alpha;
  if (selected) { g.fillStyle = FR.youSoft; g.fillRect(17, y, 356, 80); rr(g, 17, y + 12, 3, 56, 1.5, FR.you); }
  const cx = 42, cy = y + 40;
  if (kidView) { // the kid's own tappable check (button.hw-check); done fills with the app's green
    if (down > 0) { g.save(); g.globalAlpha *= 0.22 * down; g.beginPath(); g.arc(cx, cy, 20, 0, 6.283); g.fillStyle = FR.green; g.fill(); g.restore(); }
    g.beginPath(); g.arc(cx, cy, 11, 0, 6.283);
    if (check > 0.3) { g.fillStyle = FR.green; g.fill(); } else { g.lineWidth = 2; g.strokeStyle = "#D1D5DB"; g.stroke(); }
    if (check > 0.3) { g.save(); g.beginPath(); g.moveTo(cx - 5, cy + 0.5); g.lineTo(cx - 1.5, cy + 4); g.lineTo(cx + 5.5, cy - 4); g.strokeStyle = "#fff"; g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round"; g.setLineDash([22]); g.lineDashOffset = 22 * (1 - eo((check - 0.3) / 0.7)); g.stroke(); g.restore(); }
  } else if (!selected) { g.beginPath(); g.arc(cx, cy, 9, 0, 6.283); g.lineWidth = 1.5; g.strokeStyle = "#D1D5DB"; g.stroke(); }
  const tx = kidView ? 66 : 59;
  const tw = text(g, it.title, tx, y + 32, { px: 15, w: 600, color: check > 0.5 ? FR.ink3 : FR.ink });
  if (check > 0.5) { g.fillStyle = FR.ink3; g.fillRect(tx, y + 27, tw * eo((check - 0.5) / 0.5), 1.5); }
  let x = tx + text(g, it.subject, tx, y + 57, { px: 13, w: 600, color: FR.ink2 }) + 12;
  if (!kidView) { const [l, c] = KID[it.kid]; avatar(g, x + 9, y + 52.5, 9, l, c, "#fff"); x += 22; x += text(g, it.kid, x, y + 57, { px: 12, w: 500, color: FR.ink2 }) + 12; }
  text(g, `${it.mins} min estimated`, x, y + 57, { px: 13, color: FR.ink2 });
  icon(g, "chev", 356, y + 40, 0.7, FR.ink2, 2);
  g.restore();
}
// Kate's Homework page. arrive[i] ∈ [0,1] brings row i in (rows drop into their due-date group); page
// coordinates follow the real layout: Assignments at 772, Tomorrow at 824, rows 80 px apart.
export function homework(g, s) {
  const hits = {}, y = (py) => py + SB - (s.scroll ?? 0), arrive = s.arrive ?? [1, 1, 1, 1, 1];
  g.fillStyle = FR.bg; g.fillRect(0, 0, 390, 844);
  brandBar(g, y(20), "K", FR.you);
  text(g, "Homework", 17, y(101), { px: 30, w: 700, ls: -0.6 });
  [["All kids", 76, 71, 1], ["Mia", 155, 81, 0, "M", FR.teal], ["Leo", 243, 70, 0, "L", FR.amber]].forEach(([l, x, w, on, al, ac]) => {
    rr(g, x, y(124), w, 36, 18, on ? FR.youSoft : "#fff", on ? FR.you : FR.rule, 1.2);
    if (al) { avatar(g, x + 20, y(142), 10, al, ac, "#fff"); text(g, l, x + 36, y(147), { px: 14, w: 500 }); }
    else text(g, l, x + w / 2, y(147), { px: 14, w: 600, color: FR.youInk, align: "center" });
  });
  rr(g, 130, y(170), 130, 32, 16, "#fff"); text(g, "All subjects", 184, y(191), { px: 14, w: 500, color: FR.ink2, align: "center" }); icon(g, "down", 244, y(186), 0.5, FR.ink2, 2.2);
  rr(g, 130, y(219), 130, 40, 20, "#fff", FR.you, 1.5); icon(g, "camera", 154, y(239), 0.62, FR.ink, 2); text(g, "Scan diary", 204, y(245), { px: 15, w: 600, align: "center" });
  rr(g, 154, y(269), 82, 40, 20, FR.you); text(g, "+ Add", 195, y(295), { px: 15, w: 600, color: "#fff", align: "center" });
  const roll = clamp(s.roll ?? 0), miaLeft = roll > 0.5 ? 2 : 3;
  kidRingCard(g, y(351), "Mia", miaLeft, eo(roll) / 3);
  kidRingCard(g, y(446), "Leo", 1, 0);
  hits.ring = [57, y(390)]; hits.miaLeft = [95, y(400)];
  card(g, 17, y(567), 356, 158, 24);
  g.fillStyle = FR.rule; g.fillRect(195, y(587), 1, 118); g.fillRect(37, y(646), 316, 1);
  const cell = (label, value, sub, x, yy) => { text(g, label, x, yy, { px: 13, color: FR.ink2 }); const w = text(g, value, x, yy + 38, { px: 30, w: 800, ls: -0.9 }); if (sub) text(g, sub, x + w + 3, yy + 38, { px: 16, color: FR.ink2 }); };
  cell("Open assignments", roll > 0.5 ? "4" : "5", "", 37, y(597));
  cell("Due in the next 7 days", roll > 0.5 ? "4" : "5", "", 213, y(597));
  cell("Overdue", "0", "", 37, y(672));
  cell("Completed", roll > 0.5 ? "1" : "0", "/ 5", 213, y(672));
  text(g, "Assignments", 17, y(779), { px: 17, w: 700 });
  const open = HW.filter((_, i) => arrive[i] > 0.5).length;
  rr(g, 205, y(750), 168, 45, 12, FR.card2, FR.rule, 1);
  rr(g, 209, y(754), 78, 37, 8, "#fff"); text(g, "To do", 232, y(777), { px: 12, w: 600, color: FR.you, align: "center" }); text(g, String(open), 270, y(777), { px: 11, w: 600, color: FR.you });
  text(g, "Completed", 316, y(777), { px: 12, w: 600, color: FR.ink2, align: "center" }); text(g, "0", 355, y(777), { px: 11, w: 600, color: FR.ink2 });
  let py = 810;
  GROUPS.forEach((gname, gi) => {
    const rows = HW.map((it, i) => [it, i]).filter(([it]) => it.group === gi), shown = rows.map(([, i]) => eo(arrive[i]));
    const vis = Math.max(...shown);
    if (vis <= 0) return;
    const hy = py + 14;
    g.save(); g.globalAlpha *= vis;
    text(g, gname, 17, y(hy), { px: 15, w: 700 });
    const n = rows.filter(([, i]) => arrive[i] > 0.5).length;
    text(g, `${Math.max(1, n)} assignment${n > 1 ? "s" : ""}`, 373, y(hy), { px: 13, color: FR.ink2, align: "right" });
    g.restore();
    hits[`hdr${gi}`] = [17, y(hy - 5)];
    let ry = hy + 10, cardH = 0;
    rows.forEach(([, i], j) => { cardH += 80 * shown[j]; });
    if (cardH > 0) { g.save(); g.globalAlpha *= vis; card(g, 17, y(ry), 356, cardH, 20); g.restore(); }
    g.save(); g.beginPath(); g.roundRect(17, y(ry), 356, Math.max(cardH, 0.01), 20); g.clip();
    rows.forEach(([it, i], j) => {
      const k = shown[j];
      if (k <= 0) return;
      hwRow(g, it, y(ry) - (1 - k) * 26, { selected: i === 0, alpha: k });
      if (j < rows.length - 1 && k > 0.99) { g.fillStyle = FR.rule; g.fillRect(17, y(ry + 80), 356, 1); }
      hits[`row${i}`] = [200, y(ry + 40)];
      ry += 80 * k;
    });
    g.restore();
    py = ry + 16;
  });
  bottomNav(g, "Homework");
  status(g, "7:40");
  return hits;
}
// Mia's Homework page: only her own work, with her own tappable checks. Ticking the first row fills the
// check, strikes the title, then the row leaves To do (as the real list refreshes) and the rest move up.
export function kidHomework(g, s) {
  const hits = {}, y = (py) => py + SB - (s.scroll ?? 0), tick = clamp(s.tick ?? 0), leave = eo(clamp((tick - 0.55) / 0.45));
  g.fillStyle = FR.bg; g.fillRect(0, 0, 390, 844);
  brandBar(g, y(20), "M", FR.teal);
  text(g, "Homework", 17, y(101), { px: 30, w: 700, ls: -0.6 });
  rr(g, 154, y(124), 82, 36, 18, "#E6F6F4", FR.teal, 1.2); avatar(g, 174, y(142), 10, "M", FR.teal, "#fff"); text(g, "Mia", 190, y(147), { px: 14, w: 500 });
  rr(g, 130, y(170), 130, 32, 16, "#fff"); text(g, "All subjects", 184, y(191), { px: 14, w: 500, color: FR.ink2, align: "center" });
  rr(g, 130, y(219), 130, 40, 20, "#fff", FR.you, 1.5); icon(g, "camera", 154, y(239), 0.62, FR.ink, 2); text(g, "Scan diary", 204, y(245), { px: 15, w: 600, align: "center" });
  rr(g, 154, y(269), 82, 40, 20, FR.you); text(g, "+ Add", 195, y(295), { px: 15, w: 600, color: "#fff", align: "center" });
  kidRingCard(g, y(351), "Mia", tick > 0.5 ? 2 : 3, eo(clamp((tick - 0.4) / 0.6)) / 3);
  card(g, 17, y(472), 356, 156, 24);
  g.fillStyle = FR.rule; g.fillRect(195, y(492), 1, 116); g.fillRect(37, y(550), 316, 1);
  const cell = (label, value, sub, x, yy) => { text(g, label, x, yy, { px: 13, color: FR.ink2 }); const w = text(g, value, x, yy + 38, { px: 30, w: 800, ls: -0.9 }); if (sub) text(g, sub, x + w + 3, yy + 38, { px: 16, color: FR.ink2 }); };
  cell("Open assignments", tick > 0.5 ? "2" : "3", "", 37, y(502)); cell("Due in the next 7 days", tick > 0.5 ? "2" : "3", "", 213, y(502));
  cell("Overdue", "0", "", 37, y(577)); cell("Completed", tick > 0.5 ? "1" : "0", "/ 3", 213, y(577));
  text(g, "Assignments", 17, y(682), { px: 17, w: 700 });
  rr(g, 205, y(651), 168, 45, 12, FR.card2, FR.rule, 1);
  rr(g, 209, y(655), 78, 37, 8, "#fff"); text(g, "To do", 232, y(678), { px: 12, w: 600, color: FR.you, align: "center" }); text(g, tick > 0.5 ? "2" : "3", 270, y(678), { px: 11, w: 600, color: FR.you });
  text(g, "Completed", 316, y(678), { px: 12, w: 600, color: FR.ink2, align: "center" }); text(g, tick > 0.5 ? "1" : "0", 355, y(678), { px: 11, w: 600, color: FR.ink2 });
  const mine = HW.filter((it) => it.kid === "Mia");
  // Tomorrow: Fractions worksheet (leaves after the tick) + Reading log; then Friday: Volcano diagram
  text(g, "Tomorrow", 17, y(727), { px: 15, w: 700 });
  text(g, `${tick > 0.5 ? 1 : 2} assignment${tick > 0.5 ? "" : "s"}`, 373, y(727), { px: 13, color: FR.ink2, align: "right" });
  const h0 = 80 * (1 - leave), cardTop = 741;
  card(g, 17, y(cardTop), 356, h0 + 80, 20);
  g.save(); g.beginPath(); g.roundRect(17, y(cardTop), 356, h0 + 80, 20); g.clip();
  g.save(); g.beginPath(); g.rect(17, y(cardTop), 356, h0); g.clip(); // the ticked row folds away inside its own slot
  hwRow(g, mine[0], y(cardTop) - 80 * leave * 0.35, { kidView: true, check: tick, down: clamp(s.down ?? 0), alpha: 1 - leave });
  g.restore();
  if (leave < 0.99) { g.fillStyle = FR.rule; g.fillRect(17, y(cardTop + h0), 356, 1); }
  hwRow(g, mine[1], y(cardTop + h0), { kidView: true });
  g.restore();
  hits.check = [42, y(cardTop + 40)];
  const fy = cardTop + h0 + 80 + 30;
  text(g, "Friday, Oct 2", 17, y(fy), { px: 15, w: 700 }); text(g, "1 assignment", 373, y(fy), { px: 13, color: FR.ink2, align: "right" });
  card(g, 17, y(fy + 14), 356, 80, 20);
  hwRow(g, mine[2], y(fy + 14), { kidView: true });
  const tp = toast(g, "Nice work! ✅", s.toast ?? 0);
  if (tp) hits.toast = tp;
  bottomNav(g, "Homework");
  status(g, "7:52");
  return hits;
}
