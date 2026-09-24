// Weekly contribution chart, rebuilt daily by .github/workflows/snake.yml.
// Usage: GITHUB_TOKEN=... node tools/pulse.mjs <user> <outDir>
import { THEMES, loadGlyphs, typer, svg } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [user = "HuzPro", outDir = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN is not set");

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{
      totalContributions weeks{contributionDays{date contributionCount}}}}}}`,
    variables: { u: user },
  }),
});
const json = await res.json();
if (!res.ok || json.errors) throw new Error(`GraphQL failed: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
const cal = json.data.user.contributionsCollection.contributionCalendar;

const weeks = cal.weeks.map((w) => ({
  start: w.contributionDays[0].date,
  total: w.contributionDays.reduce((s, d) => s + d.contributionCount, 0),
}));
const days = cal.weeks.flatMap((w) => w.contributionDays);
const recent = days.slice(-90).reduce((s, d) => s + d.contributionCount, 0);
const busiest = Math.max(...weeks.map((w) => w.total));
const today = days[days.length - 1].date;

const G = loadGlyphs();
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const fmt = (v) => Math.round(v * 10) / 10;
const n = (v) => v.toLocaleString("en-US");

function pulse(c) {
  const T = typer(G);
  const W = 900, H = 240, L = 44, RR = 856;
  const CX = 300, CW = RR - CX, TOP = 92, BASE = 190;
  const step = CW / weeks.length, bw = Math.max(3, step * 0.62);
  const bars = weeks.map((w, i) => {
    const x = CX + i * step + (step - bw) / 2;
    const h = w.total ? Math.max(3, (w.total / busiest) * (BASE - TOP)) : 0;
    return h
      ? `<rect class="bar" style="animation-delay:${fmt(0.15 + i * 0.018)}s" x="${fmt(x)}" y="${fmt(BASE - h)}" width="${fmt(bw)}" height="${fmt(h)}" rx="${fmt(bw / 2)}"/>`
      : `<circle cx="${fmt(x + bw / 2)}" cy="${BASE - 2}" r="1.3" fill="${c.faint}"/>`;
  });
  let lastMonth = -1;
  const ticks = weeks.map((w, i) => {
    const m = new Date(w.start + "T00:00:00Z").getUTCMonth();
    if (m === lastMonth || i === 0) { lastMonth = m; return ""; }
    lastMonth = m;
    return T.text(MONTHS[m], { x: CX + i * step, y: BASE + 22, size: 10, weight: 400 }, `fill="${c.faint}"`);
  }).join("");

  const css = `
    .bar{fill:url(#bg);transform-box:fill-box;transform-origin:50% 100%;animation:grow .9s cubic-bezier(.2,.7,.2,1) both}
    @keyframes grow{from{transform:scaleY(0)}}
    .scan{animation:scan 6s cubic-bezier(.5,0,.5,1) 1.4s infinite}
    @keyframes scan{from{transform:translateX(${CX - 120}px)}60%,to{transform:translateX(${RR + 40}px)}}
    @media (prefers-reduced-motion:reduce){*{animation:none!important}}`;

  const body = `
  <defs>__DEFS__
    <linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="${BASE}" x2="0" y2="${TOP}">
      <stop offset="0" stop-color="${c.pop}" stop-opacity=".55"/><stop offset=".6" stop-color="${c.pop}"/><stop offset="1" stop-color="${c.pop2}"/></linearGradient>
    <linearGradient id="sg"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <clipPath id="bars">${bars.filter((b) => b.startsWith("<rect")).map((b) => b.replace(/class="bar" style="[^"]*" /, "")).join("")}</clipPath>
    <pattern id="dg" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r=".8" fill="${c.grid}"/></pattern>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="${c.bg}"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="url(#dg)"/>
  <path d="M24 62H876M24 1V${H - 1}M876 1V${H - 1}M${CX - 24} 84V${BASE + 26}" stroke="${c.edge}" fill="none"/>
  ${T.text("CONTRIBUTIONS PER WEEK", { x: L, y: 44, size: 11.5, weight: 600, track: 1.8 }, `fill="${c.mute}"`)}
  ${T.text(`UPDATED ${today}`, { x: RR, y: 44, size: 11.5, weight: 600, track: 1.8, anchor: "end" }, `fill="${c.mute}"`)}
  ${T.text(n(cal.totalContributions), { x: L, y: 130, size: 46, weight: 700 }, `fill="${c.ink}"`)}
  ${T.text("in the last 12 months", { x: L, y: 152, size: 12, weight: 400 }, `fill="${c.mute}"`)}
  ${T.text("BUSIEST WEEK", { x: L, y: 186, size: 9.5, weight: 600, track: 1.2 }, `fill="${c.faint}"`)}
  ${T.text(n(busiest), { x: L, y: 206, size: 15, weight: 600 }, `fill="${c.pop}"`)}
  ${T.text("LAST 90 DAYS", { x: L + 120, y: 186, size: 9.5, weight: 600, track: 1.2 }, `fill="${c.faint}"`)}
  ${T.text(n(recent), { x: L + 120, y: 206, size: 15, weight: 600 }, `fill="${c.pop2}"`)}
  <path d="M${CX} ${BASE + 0.5}H${RR}" stroke="${c.edge}"/>
  ${bars.join("")}
  <g clip-path="url(#bars)"><rect class="scan" x="0" y="${TOP}" width="90" height="${BASE - TOP}" fill="url(#sg)" opacity="${c === THEMES.dark ? 0.5 : 0.8}"/></g>
  ${ticks}
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14.5" fill="none" stroke="${c.edge}"/>`;
  return svg(W, H, body.replace("__DEFS__", T.defs()), {
    title: `${n(cal.totalContributions)} contributions in the last 12 months, busiest week ${busiest}, ${n(recent)} in the last 90 days.`,
    css,
  });
}

mkdirSync(outDir, { recursive: true });
for (const mode of ["dark", "light"]) {
  const file = join(outDir, `pulse-${mode}.svg`);
  writeFileSync(file, pulse(THEMES[mode]));
  console.log(file);
}
