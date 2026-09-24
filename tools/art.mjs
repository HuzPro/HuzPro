// Builds the static profile art into assets/: node tools/art.mjs
// Also refreshes tools/glyphs.json (used by pulse.mjs in CI) when the font is present.
import { existsSync, writeFileSync } from "node:fs";
import { loadFont } from "./font.mjs";
import { THEMES, GLYPHS, loadGlyphs, typer, svg, write, rng } from "./lib.mjs";

const FONT = "C:/Windows/Fonts/CascadiaCode.ttf";
const WEIGHTS = [400, 600, 700];
const CHARSET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") + "·—→●✓";

if (existsSync(FONT)) {
  const f = loadFont(FONT);
  const w = {};
  for (const wt of WEIGHTS) {
    w[wt] = {};
    for (const ch of CHARSET) w[wt][ch] = f.glyphPath(ch, { wght: wt }).d;
  }
  const adv = f.glyphPath("a").advance;
  writeFileSync(
    GLYPHS,
    JSON.stringify({ font: "Cascadia Code, SIL Open Font License 1.1, (c) Microsoft", upm: f.upm, adv, w }),
  );
}
const G = loadGlyphs();

// ---------------------------------------------------------------- the words
export const WORDS = [
  ["support agents", "answering a business's customers over email and voice"],
  ["lead trackers", "agents that keep a small team's pipeline moving"],
  ["ad-account audits", "agents that go through ad accounts and flag what's off"],
  ["agent infrastructure", "auth, secrets, email and deploys behind every agent"],
  ["OAuth & secrets", "a self-hosted OAuth broker and a credential manager"],
  ["deploy pipelines", "dev on push, prod on promote, /healthz names the commit"],
  ["developer platforms", "the platform each customer's agents ship on"],
  ["test infrastructure", "pytest-lanes, pytest-uia and tk-uia on PyPI"],
];

// ---------------------------------------------------------------- helpers
function flatten(d) {
  // path (M/L/Q/Z) -> polygons
  const polys = [];
  let cur = null, px = 0, py = 0;
  for (const [, cmd, nums] of d.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
    const n = nums.trim() ? nums.trim().split(/\s+/).map(Number) : [];
    if (cmd === "M") { cur = [[n[0], n[1]]]; polys.push(cur); [px, py] = n; }
    else if (cmd === "L") { cur.push([n[0], n[1]]); [px, py] = n; }
    else if (cmd === "Q") {
      for (let t = 0.125; t <= 1; t += 0.125) {
        const a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t * t;
        cur.push([a * px + b * n[0] + c * n[2], a * py + b * n[1] + c * n[3]]);
      }
      [px, py] = [n[2], n[3]];
    }
  }
  return polys;
}
function inside(polys, x, y) {
  let wn = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
      if (y1 <= y) { if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) wn++; }
      else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) wn--;
    }
  }
  return wn !== 0;
}
const fmt = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------- hero
// Top: dot-matrix wordmark + colophon rows. Bottom: "I build <rotating phrase>",
// sized so the phrase stays readable when GitHub scales the image to a phone.
function hero(c) {
  const T = typer(G);
  const W = 900, H = 436, L = 44, RR = 856;
  const R = rng(7);
  const STEP = 2.6, cycle = STEP * WORDS.length, slot = 100 / WORDS.length;

  // dot-matrix wordmark, rasterised from the bold outline
  const word = T.outline("huz", { x: 46, y: 226, size: 184, weight: 700 });
  const polys = flatten(word.d);
  const P = 6.2, x0 = 44, x1 = 46 + word.w;
  const bands = 12;
  const groups = Array.from({ length: bands }, () => []);
  for (let y = 86; y < 232; y += P) for (let x = x0; x < x1 + 4; x += P) {
    if (!inside(polys, x, y)) continue;
    const band = Math.min(bands - 1, Math.floor(((x - x0) / (x1 - x0)) * bands));
    groups[band].push(`<circle class="b${Math.floor(R() * 6)}" cx="${fmt(x)}" cy="${fmt(y)}" r="2.05"/>`);
  }
  const wordmark = groups.map((g, i) => `<g class="s s${i}">${g.join("")}</g>`).join("");

  // starfield + a few constellation lines
  const pts = [], stars = [];
  for (let i = 0; i < 70; i++) {
    const x = 30 + R() * (W - 60), y = 70 + R() * (H - 90);
    pts.push([x, y]);
    stars.push(`<circle class="t t${i % 4}" cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(0.6 + R() * 1.1)}"/>`);
  }
  const lines = pts.slice(0, 18).map(([ax, ay]) => {
    const [bx, by] = pts.slice(18).sort((p, q) => Math.hypot(p[0] - ax, p[1] - ay) - Math.hypot(q[0] - ax, q[1] - ay))[0];
    return `M${fmt(ax)} ${fmt(ay)}L${fmt(bx)} ${fmt(by)}`;
  });

  // colophon rows beside the wordmark
  const CX = 436, rows = [
    ["NOW", "agents for small businesses"],
    ["ALSO", "the platform they run on"],
    ["OPEN SOURCE", "3 libraries on PyPI"],
    ["SITE", "huzdev.me"],
  ];
  const colophon = rows.map(([k, v], i) => {
    const y = 100 + i * 36;
    return T.text(k, { x: CX, y, size: 10.5, weight: 600, track: 1.6 }, `fill="${c.faint}"`) +
      T.text(v, { x: RR, y: y + 0.5, size: 14, weight: 400, anchor: "end" }, `fill="${c.ink}"`) +
      (i < rows.length - 1 ? `<path d="M${CX} ${y + 17}H${RR}" stroke="${c.edge}" stroke-dasharray="1 3"/>` : "");
  }).join("");

  // the rotating line
  const PY = 346, SIZE = 46;
  const ibuild = T.text("I build", { x: L, y: 290, size: 17, weight: 400 }, `fill="${c.mute}"`);
  const numW = T.width(" / 08", 12);
  const phrases = WORDS.map(([w], i) => `<g class="w" style="animation-delay:${fmt(i * STEP)}s">` +
    T.text(w, { x: L, y: PY, size: SIZE, weight: 600 }, `fill="${c.ink}"`) + `</g>`).join("");
  const subs = WORDS.map(([, sub], i) => `<g class="w" style="animation-delay:${fmt(i * STEP + 0.12)}s">` +
    T.text(sub, { x: L, y: 398, size: 15, weight: 400 }, `fill="${c.mute}"`) + `</g>`).join("");
  const counters = WORDS.map((_, i) => `<g class="w" style="animation-delay:${fmt(i * STEP)}s">` +
    T.text(String(i + 1).padStart(2, "0"), { x: RR - numW, y: 290, size: 12, weight: 600, anchor: "end" }, `fill="${c.pop}"`) + `</g>`).join("");
  const counterTotal = T.text(` / ${String(WORDS.length).padStart(2, "0")}`, { x: RR, y: 290, size: 12, weight: 400, anchor: "end" }, `fill="${c.faint}"`);

  // underline grows to each phrase's width, collapses between phrases
  let uk = "";
  WORDS.forEach(([w], i) => {
    const a = i * slot, wv = fmt(T.width(w, SIZE));
    uk += `${fmt(a)}%{transform:scaleX(0)}${fmt(a + slot * 0.16)}%,${fmt(a + slot * 0.84)}%{transform:scaleX(${wv})}`;
  });
  uk += "100%{transform:scaleX(0)}";

  const css = `
    .s{fill:${c.pop};animation:sweep 7s ease-in-out infinite}
    ${Array.from({ length: bands }, (_, i) => `.s${i}{animation-delay:${fmt(1.4 + i * 0.09)}s}`).join("")}
    @keyframes sweep{0%,16%,100%{fill:${c.pop};opacity:.92}6%{fill:${c.pop2};opacity:1}}
    ${Array.from({ length: 6 }, (_, i) => `.b${i}{animation:boot .5s ${fmt(0.08 + i * 0.13)}s both}`).join("")}
    @keyframes boot{from{opacity:0}to{opacity:1}}
    .t{fill:${c.faint};animation:tw 5s ease-in-out infinite}
    .t1{animation-delay:-1.2s}.t2{animation-delay:-2.5s}.t3{animation-delay:-3.7s}
    @keyframes tw{0%,100%{opacity:.2}50%{opacity:.75}}
    .con{stroke:${c.pop2};stroke-opacity:.22;stroke-dasharray:3 5;animation:drift 30s linear infinite}
    @keyframes drift{to{stroke-dashoffset:-160}}
    .w{opacity:0;animation:word ${cycle}s cubic-bezier(.2,.7,.2,1) infinite both}
    @keyframes word{0%{opacity:0;transform:translateY(20px)}
      ${fmt(slot * 0.14)}%,${fmt(slot * 0.86)}%{opacity:1;transform:none}
      ${fmt(slot)}%,100%{opacity:0;transform:translateY(-20px)}}
    .ul{fill:${c.pop};transform-origin:0 0;animation:ul ${cycle}s cubic-bezier(.2,.7,.2,1) infinite both}
    @keyframes ul{${uk}}
    .glow{animation:breathe 9s ease-in-out infinite alternate}
    @keyframes breathe{from{opacity:.55}to{opacity:1}}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}.w:first-of-type{opacity:1}}`;

  const body = `
  <defs>__DEFS__
    <radialGradient id="g1" cx="0.2" cy="0.35" r="0.42"><stop offset="0" stop-color="${c.glow1}"/><stop offset="1" stop-color="${c.glow1}" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0.88" cy="0.78" r="0.4"><stop offset="0" stop-color="${c.glow2}"/><stop offset="1" stop-color="${c.glow2}" stop-opacity="0"/></radialGradient>
    <pattern id="dg" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r=".8" fill="${c.grid}"/></pattern>
    <clipPath id="panel"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14"/></clipPath>
    <clipPath id="slot"><rect x="${L - 4}" y="296" width="${RR - L + 8}" height="68"/></clipPath>
    <clipPath id="slot2"><rect x="${L - 4}" y="380" width="${RR - L + 8}" height="26"/></clipPath>
    <clipPath id="slot3"><rect x="${RR - 80}" y="274" width="84" height="24"/></clipPath>
  </defs>
  <g clip-path="url(#panel)">
    <rect width="${W}" height="${H}" fill="${c.bg}"/>
    <rect width="${W}" height="${H}" fill="url(#dg)"/>
    <rect class="glow" width="${W}" height="${H}" fill="url(#g1)"/>
    <rect class="glow" style="animation-delay:-4s" width="${W}" height="${H}" fill="url(#g2)"/>
    <path class="con" fill="none" d="${lines.join("")}"/>
    ${stars.join("")}
    <path d="M24 62H876M24 254H876M24 0V${H}M876 0V${H}" stroke="${c.edge}" fill="none"/>
    <path d="M${CX - 28} 84V232" stroke="${c.edge}" stroke-dasharray="2 4" fill="none"/>
  </g>
  ${T.text("HUZ  /  HUZPRO", { x: L, y: 44, size: 11.5, weight: 600, track: 1.8 }, `fill="${c.mute}"`)}
  ${T.text("AGENTS  ·  PLATFORMS  ·  INFRA", { x: RR, y: 44, size: 11.5, weight: 600, track: 1.8, anchor: "end" }, `fill="${c.mute}"`)}
  ${wordmark}
  ${colophon}
  ${ibuild}
  <g clip-path="url(#slot3)">${counters}</g>${counterTotal}
  <g clip-path="url(#slot)">${phrases}</g>
  <g transform="translate(${L} 362)"><rect class="ul" width="1" height="3" rx="1"/></g>
  <g clip-path="url(#slot2)">${subs}</g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14.5" fill="none" stroke="${c.edge}"/>`;

  const title = "Huz. I build " + WORDS.map(([w]) => w).join(", ") + ".";
  return svg(W, H, body.replace("__DEFS__", T.defs()), { title, css });
}

for (const mode of ["dark", "light"]) {
  console.log(write(`assets/hero-${mode}.svg`, hero(THEMES[mode])));
}
