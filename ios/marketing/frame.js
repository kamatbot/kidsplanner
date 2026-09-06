#!/usr/bin/env node
"use strict";
/**
 * Fam ETC App Store screenshot framer — copied from RetireOdds ios/marketing/frame.js
 * (the canonical pipeline; only SLIDES, fonts and colours changed).
 *
 * Composites REAL simulator captures onto a Horizon-branded canvas: greige
 * background with soft coral/violet glows, a two-line headline (second line in
 * the coral→violet momentum gradient — the ONE gradient element per slide), and
 * the capture floating as a rounded device. One responsive HTML per slide,
 * rendered by headless Chrome at every App Store size (see frame.sh).
 *
 *   SHOTS_DIR      raw captures root (default ./shots). Expects shots/iphone/*.png
 *                  and shots/ipad/*.png named per SLIDES[].img.
 */
const fs = require("fs");
const path = require("path");

const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "shots");
const OUT = path.join(__dirname, "frame-html");
const FONT = path.join(__dirname, "..", "FamETC", "Resources", "spacegrotesk.woff2");

// All slides are LIGHT mode (APP-BRIEF: marketing screenshots in light mode).
// Headlines: l1 in ink, l2 in the gradient. Keep each line ≤ ~20 chars.
const SLIDES = {
  iphone: [
    { id: "01-today",    img: "01-today.png",    l1: "Everyone knows",    l2: "what today looks like" },
    { id: "02-homework", img: "02-homework.png", l1: "Nobody types",      l2: "the homework in" },
    { id: "03-chat",     img: "03-chat.png",     l1: "The thread where",  l2: "things get decided" },
    { id: "04-calendar", img: "04-calendar.png", l1: "The family week",   l2: "at a glance" },
    { id: "05-meals",    img: "05-meals.png",    l1: "Dinner decided,",   l2: "list written" },
  ],
  ipad: [
    { id: "01-today",    img: "01-today.png",    l1: "One calm place",    l2: "to run the family" },
    { id: "02-homework", img: "02-homework.png", l1: "Nobody types",      l2: "the homework in" },
    { id: "03-chat",     img: "03-chat.png",     l1: "The thread where",  l2: "things get decided" },
    { id: "04-calendar", img: "04-calendar.png", l1: "The family week",   l2: "at a glance" },
    { id: "05-meals",    img: "05-meals.png",    l1: "Dinner decided,",   l2: "list written" },
  ],
  // Apple Watch: one short line each (416x496 canvas leaves no room for two).
  watch: [
    { id: "01-my-next",  img: "01-my-next.png",  l1: "Next up,",   l2: "on your wrist" },
    { id: "02-homework", img: "02-homework.png", l1: "Homework,",  l2: "on time" },
    { id: "03-shopping", img: "03-shopping.png", l1: "The list,",  l2: "in the shop" },
  ],
};

const CSS = `
@font-face{font-family:"Space Grotesk";src:url("file://${FONT}") format("woff2");font-weight:300 700;}
*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased;}
html,body{width:100%;height:100%;overflow:hidden;}
:root{ --sans:"Space Grotesk",-apple-system,BlinkMacSystemFont,"SF Pro Display",Helvetica,Arial,sans-serif;
  --coral:#F0704F; --violet:#6F43D6; --ink:#211E1B; }
.stage{width:100vw;height:100vh;display:flex;flex-direction:column;align-items:center;
  padding:7vh 0 0;position:relative;overflow:hidden;font-family:var(--sans);
  background:
    radial-gradient(90% 55% at 82% 4%, rgba(240,112,79,.16), transparent 60%),
    radial-gradient(95% 60% at 8% 42%, rgba(111,67,214,.14), transparent 62%),
    linear-gradient(180deg,#F3F0EC 0%, #EAE6E0 100%);}
.head{text-align:center;padding:0 6vw;flex:0 0 auto;}
.head .l1,.head .l2{font-weight:700;letter-spacing:-.025em;line-height:1.06;font-size:var(--fs);white-space:nowrap;}
.head .l1{color:var(--ink);}
.head .l2{background:linear-gradient(100deg,var(--coral),var(--violet));
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
.deviceWrap{flex:1 1 auto;display:flex;align-items:center;justify-content:center;
  width:100%;padding:4.5vh 0 5vh;min-height:0;}
.device{max-width:82%;max-height:100%;width:auto;height:auto;display:block;
  border-radius:var(--radius);outline:1px solid rgba(20,16,24,.06);
  box-shadow:0 3vh 8vh rgba(20,16,24,.22), 0 .4vh 1.2vh rgba(20,16,24,.14);}
`;

// iPhone canvases are tall (≈1:2.16) → bigger type; iPad canvases (≈3:4) → smaller;
// watch canvases are tiny (416x496) → both lines side by side, big corner radius.
const TUNE = {
  iphone: ":root{--fs:7.4vw;--radius:5.2%/2.4%;}",
  ipad:   ":root{--fs:5.6vw;--radius:2.6%/1.95%;}",
  watch:  ":root{--fs:8.6vw;--radius:22%;} .stage{padding-top:5vh;} .head{display:flex;gap:.35em;justify-content:center;} .deviceWrap{padding:3.5vh 0 4vh;} .device{max-width:78%;}",
};
const page = (s, kind) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${CSS}
${TUNE[kind]}
</style></head>
<body>
  <div class="stage">
    <div class="head"><div class="l1">${s.l1}</div><div class="l2">${s.l2}</div></div>
    <div class="deviceWrap"><img class="device" src="file://${path.join(SHOTS, kind, s.img)}" alt=""></div>
  </div>
</body></html>`;

let n = 0;
for (const kind of Object.keys(SLIDES)) {
  fs.mkdirSync(path.join(OUT, kind), { recursive: true });
  for (const s of SLIDES[kind]) {
    if (!fs.existsSync(path.join(SHOTS, kind, s.img))) { console.warn("skip (no capture):", kind, s.img); continue; }
    fs.writeFileSync(path.join(OUT, kind, s.id + ".html"), page(s, kind)); n++;
  }
}
console.log("wrote", n, "framed slides to", path.relative(process.cwd(), OUT));
