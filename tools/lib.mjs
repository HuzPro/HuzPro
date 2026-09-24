// Shared bits for the profile art: palettes, text-as-paths, SVG wrapper.
// Text is converted to outlines (Cascadia Code, SIL OFL 1.1) because an SVG shown
// through <img> on GitHub cannot load fonts, and system fonts differ per viewer.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const GLYPHS = join(ROOT, "tools", "glyphs.json");

// Lagoon, the huzdev.me palette: cyan accent, magenta lines.
export const THEMES = {
  dark: {
    bg: "#070e11", edge: "#1b2b31", grid: "#11202a", ink: "#e2eef1", mute: "#8aa9b1",
    faint: "#62808a", pop: "#6fd6e8", pop2: "#3ec27f", glow1: "#13334a", glow2: "#0f3b26",
    glow3: "#1c4a44", chip: "#0c181d",
  },
  light: {
    bg: "#f4f9fb", edge: "#cfdfe5", grid: "#e1ecf0", ink: "#0f2a33", mute: "#4a5f67",
    faint: "#5b757e", pop: "#1a6f80", pop2: "#17693f", glow1: "#cdebf1", glow2: "#d2ecdc",
    glow3: "#cdeee4", chip: "#ffffff",
  },
};

export function loadGlyphs() {
  return JSON.parse(readFileSync(GLYPHS, "utf8"));
}

const r1 = (v) => Math.round(v * 10) / 10;

// Text runs are <use> references to one outline per glyph, so repeated letters cost
// ~50 bytes each. Make one typer per SVG document and put typer.defs() in <defs>.
export function typer(glyphs) {
  const { upm, adv } = glyphs;
  const used = new Map();
  function width(str, size, track = 0) {
    const n = [...str].length;
    return (n * adv * size) / upm + Math.max(0, n - 1) * track;
  }
  function uses(str, { x = 0, y = 0, size = 14, weight = 400, track = 0, anchor = "start" } = {}) {
    const set = glyphs.w[weight];
    if (!set) throw new Error(`weight ${weight} not in glyphs.json`);
    const s = size / upm;
    const w = width(str, size, track);
    let cx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    let out = "";
    for (const ch of str) {
      if (!(ch in set)) throw new Error(`glyph ${JSON.stringify(ch)} missing at ${weight}`);
      if (set[ch]) {
        const id = `g${weight}-${ch.codePointAt(0).toString(36)}`;
        used.set(id, set[ch]);
        out += `<use href="#${id}" transform="translate(${r1(cx)} ${r1(y)}) scale(${+s.toFixed(5)})"/>`;
      }
      cx += adv * s + track;
    }
    return { out, w };
  }
  // attrs go on the wrapping <g>, e.g. fill="#fff" class="x"
  function text(str, opts = {}, attrs = "") {
    const { out } = uses(str, opts);
    return out ? `<g ${attrs}>${out}</g>` : "";
  }
  // raw outline for one run, page space (for rasterising)
  function outline(str, { x = 0, y = 0, size = 14, weight = 400 } = {}) {
    const set = glyphs.w[weight], s = size / upm;
    let cx = x, d = "";
    for (const ch of str) {
      d += set[ch].replace(/([MLQ])([^MLQZ]+)/g, (_, cmd, nums) => {
        const n = nums.trim().split(/\s+/).map(Number);
        const o = [];
        for (let i = 0; i < n.length; i += 2) o.push(r1(cx + n[i] * s), r1(y + n[i + 1] * s));
        return cmd + o.join(" ");
      });
      cx += adv * s;
    }
    return { d, w: width(str, size) };
  }
  const defs = () => [...used].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join("");
  return { text, width, outline, defs };
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function svg(w, h, body, { title = "", css = "" } = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"` +
    `${title ? ` aria-label="${esc(title)}"` : ""}>` +
    (css ? `<style>${css.replace(/\s+/g, " ").trim()}</style>` : "") +
    body +
    `</svg>\n`
  );
}

export function write(rel, content) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

// Deterministic PRNG so rebuilds produce identical files.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
