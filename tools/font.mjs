// Minimal TrueType reader: cmap, glyf outlines, and gvar/avar so a variable font
// can be read at any weight. Enough to turn Cascadia Code into SVG path data.
import { readFileSync } from "node:fs";

export function loadFont(file) {
  const b = readFileSync(file);
  const tables = {};
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const o = 12 + 16 * i;
    tables[b.toString("ascii", o, o + 4)] = b.readUInt32BE(o + 8);
  }
  const f2 = (o) => b.readInt16BE(o) / 16384;
  const upm = b.readUInt16BE(tables.head + 18);
  const longLoca = b.readInt16BE(tables.head + 50) === 1;
  const numGlyphs = b.readUInt16BE(tables.maxp + 4);
  const numHMetrics = b.readUInt16BE(tables.hhea + 34);

  const locaAt = (g) =>
    longLoca ? b.readUInt32BE(tables.loca + 4 * g) : 2 * b.readUInt16BE(tables.loca + 2 * g);
  const advance = (g) => b.readUInt16BE(tables.hmtx + 4 * Math.min(g, numHMetrics - 1));

  // cmap: format 4 (BMP) or 12 (full)
  const cmap = new Map();
  {
    const c = tables.cmap;
    let best = null;
    for (let i = 0; i < b.readUInt16BE(c + 2); i++) {
      const p = b.readUInt16BE(c + 4 + 8 * i), e = b.readUInt16BE(c + 6 + 8 * i);
      const off = c + b.readUInt32BE(c + 8 + 8 * i);
      const fmt = b.readUInt16BE(off);
      if (p === 3 && e === 10 && fmt === 12) best = off;
      else if (!best && p === 3 && e === 1 && fmt === 4) best = off;
    }
    if (b.readUInt16BE(best) === 12) {
      const n = b.readUInt32BE(best + 12);
      for (let i = 0; i < n; i++) {
        const o = best + 16 + 12 * i;
        const s = b.readUInt32BE(o), e = b.readUInt32BE(o + 4), g = b.readUInt32BE(o + 8);
        for (let cp = s; cp <= e; cp++) cmap.set(cp, g + cp - s);
      }
    } else {
      const segX2 = b.readUInt16BE(best + 6);
      const ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      for (let i = 0; i < segX2 / 2; i++) {
        const e = b.readUInt16BE(ends + 2 * i), s = b.readUInt16BE(starts + 2 * i);
        const d = b.readInt16BE(deltas + 2 * i), ro = b.readUInt16BE(ranges + 2 * i);
        for (let cp = s; cp <= e && cp !== 0xffff; cp++) {
          let g;
          if (ro === 0) g = (cp + d) & 0xffff;
          else {
            g = b.readUInt16BE(ranges + 2 * i + ro + 2 * (cp - s));
            if (g) g = (g + d) & 0xffff;
          }
          cmap.set(cp, g);
        }
      }
    }
  }

  // fvar / avar
  const axes = [];
  if (tables.fvar) {
    const f = tables.fvar;
    let p = f + b.readUInt16BE(f + 4);
    for (let i = 0; i < b.readUInt16BE(f + 8); i++) {
      axes.push({
        tag: b.toString("ascii", p, p + 4),
        min: b.readInt32BE(p + 4) / 65536,
        def: b.readInt32BE(p + 8) / 65536,
        max: b.readInt32BE(p + 12) / 65536,
      });
      p += b.readUInt16BE(f + 10);
    }
  }
  const avar = [];
  if (tables.avar) {
    let p = tables.avar + 8;
    for (let a = 0; a < axes.length; a++) {
      const n = b.readUInt16BE(p);
      const map = [];
      for (let i = 0; i < n; i++) map.push([f2(p + 2 + 4 * i), f2(p + 4 + 4 * i)]);
      avar.push(map);
      p += 2 + 4 * n;
    }
  }
  function normalize(values) {
    return axes.map((ax, i) => {
      const v = Math.min(ax.max, Math.max(ax.min, values[ax.tag] ?? ax.def));
      let n = v < ax.def ? (v - ax.def) / (ax.def - ax.min) : v > ax.def ? (v - ax.def) / (ax.max - ax.def) : 0;
      const m = avar[i];
      if (m && m.length) {
        for (let k = 1; k < m.length; k++) {
          if (n <= m[k][0]) {
            const [a0, b0] = m[k - 1], [a1, b1] = m[k];
            n = a1 === a0 ? b1 : b0 + ((n - a0) * (b1 - b0)) / (a1 - a0);
            break;
          }
        }
      }
      return n;
    });
  }

  // gvar
  const gv = tables.gvar;
  let gvShared = [], gvLong = false, gvData = 0;
  if (gv) {
    const axisCount = b.readUInt16BE(gv + 4);
    const sharedCount = b.readUInt16BE(gv + 6);
    const sharedOff = gv + b.readUInt32BE(gv + 8);
    gvLong = (b.readUInt16BE(gv + 14) & 1) === 1;
    gvData = gv + b.readUInt32BE(gv + 16);
    for (let i = 0; i < sharedCount; i++) {
      const t = [];
      for (let a = 0; a < axisCount; a++) t.push(f2(sharedOff + 2 * (i * axisCount + a)));
      gvShared.push(t);
    }
  }
  const gvOffset = (g) =>
    gvLong ? b.readUInt32BE(gv + 20 + 4 * g) : 2 * b.readUInt16BE(gv + 20 + 2 * g);

  function readPoints(p, total) {
    let count = b[p++];
    if (count === 0) return { pts: null, p };
    if (count & 0x80) count = ((count & 0x7f) << 8) | b[p++];
    const pts = [];
    let last = 0;
    while (pts.length < count) {
      const ctl = b[p++];
      const run = (ctl & 0x7f) + 1;
      for (let i = 0; i < run && pts.length < count; i++) {
        if (ctl & 0x80) { last += b.readUInt16BE(p); p += 2; }
        else last += b[p++];
        pts.push(last);
      }
    }
    return { pts, p };
  }
  function readDeltas(p, count) {
    const out = [];
    while (out.length < count) {
      const ctl = b[p++];
      const run = (ctl & 0x3f) + 1;
      for (let i = 0; i < run && out.length < count; i++) {
        if (ctl & 0x80) out.push(0);
        else if (ctl & 0x40) { out.push(b.readInt16BE(p)); p += 2; }
        else { out.push(b.readInt8(p)); p += 1; }
      }
    }
    return { out, p };
  }

  // Returns per-point [dx, dy] deltas for glyph g (points include 4 phantoms).
  function glyphDeltas(g, coords, orig, contourEnds) {
    const n = orig.length;
    const total = Array.from({ length: n }, () => [0, 0]);
    if (!gv) return total;
    const start = gvOffset(g), end = gvOffset(g + 1);
    if (start === end) return total;
    const base = gvData + start;
    const tvc = b.readUInt16BE(base);
    const count = tvc & 0x0fff;
    let dataP = base + b.readUInt16BE(base + 2);
    let hp = base + 4;
    let shared = null;
    if (tvc & 0x8000) {
      const r = readPoints(dataP, n);
      shared = r.pts;
      dataP = r.p;
    }
    for (let t = 0; t < count; t++) {
      const size = b.readUInt16BE(hp);
      const idx = b.readUInt16BE(hp + 2);
      hp += 4;
      let peak;
      if (idx & 0x8000) {
        peak = coords.map((_, a) => f2(hp + 2 * a));
        hp += 2 * coords.length;
      } else peak = gvShared[idx & 0x0fff];
      let startT = null, endT = null;
      if (idx & 0x4000) {
        startT = coords.map((_, a) => f2(hp + 2 * a));
        hp += 2 * coords.length;
        endT = coords.map((_, a) => f2(hp + 2 * a));
        hp += 2 * coords.length;
      }
      let scalar = 1;
      for (let a = 0; a < coords.length; a++) {
        const pk = peak[a], v = coords[a];
        if (pk === 0) continue;
        if (v === 0) { scalar = 0; break; }
        const s = startT ? startT[a] : Math.min(0, pk), e = endT ? endT[a] : Math.max(0, pk);
        if (v < s || v > e) { scalar = 0; break; }
        if (v === pk) continue;
        scalar *= v < pk ? (v - s) / (pk - s) : (e - v) / (e - pk);
      }
      let p = dataP;
      dataP += size;
      if (scalar === 0) continue;
      let pts = shared;
      if (idx & 0x2000) {
        const r = readPoints(p, n);
        pts = r.pts;
        p = r.p;
      }
      const m = pts ? pts.length : n;
      const xs = readDeltas(p, m);
      const ys = readDeltas(xs.p, m);
      if (!pts) {
        for (let i = 0; i < n; i++) {
          total[i][0] += xs.out[i] * scalar;
          total[i][1] += ys.out[i] * scalar;
        }
        continue;
      }
      // explicit points: infer untouched ones (IUP) per contour
      const d = new Map();
      pts.forEach((pi, i) => { if (pi < n) d.set(pi, [xs.out[i], ys.out[i]]); });
      const local = Array.from({ length: n }, (_, i) => d.get(i) ?? null);
      if (contourEnds) {
        let s0 = 0;
        for (const e0 of contourEnds) {
          iup(local, orig, s0, e0);
          s0 = e0 + 1;
        }
      }
      for (let i = 0; i < n; i++) {
        if (!local[i]) continue;
        total[i][0] += local[i][0] * scalar;
        total[i][1] += local[i][1] * scalar;
      }
    }
    return total;
  }

  function iup(d, orig, s, e) {
    const touched = [];
    for (let i = s; i <= e; i++) if (d[i]) touched.push(i);
    if (!touched.length) return;
    if (touched.length === 1) {
      for (let i = s; i <= e; i++) if (!d[i]) d[i] = [...d[touched[0]]];
      return;
    }
    for (let k = 0; k < touched.length; k++) {
      const a = touched[k], c = touched[(k + 1) % touched.length];
      let i = a + 1;
      while (true) {
        if (i > e) i = s;
        if (i === c) break;
        const out = [0, 0];
        for (const ax of [0, 1]) {
          const c1 = orig[a][ax], c2 = orig[c][ax], d1 = d[a][ax], d2 = d[c][ax];
          const v = orig[i][ax];
          if (c1 === c2) out[ax] = d1 === d2 ? d1 : 0;
          else {
            const [lo, dlo, hi, dhi] = c1 < c2 ? [c1, d1, c2, d2] : [c2, d2, c1, d1];
            if (v <= lo) out[ax] = dlo;
            else if (v >= hi) out[ax] = dhi;
            else out[ax] = dlo + ((v - lo) * (dhi - dlo)) / (hi - lo);
          }
        }
        d[i] = out;
        i++;
      }
    }
  }

  // Returns contours: arrays of {x, y, on} in font units (y up).
  function outline(g, coords) {
    const off = tables.glyf + locaAt(g);
    if (locaAt(g) === locaAt(g + 1)) return [];
    const nc = b.readInt16BE(off);
    const adv = advance(g);
    if (nc >= 0) {
      const ends = [];
      for (let i = 0; i < nc; i++) ends.push(b.readUInt16BE(off + 10 + 2 * i));
      const np = nc ? ends[nc - 1] + 1 : 0;
      let p = off + 10 + 2 * nc;
      p += 2 + b.readUInt16BE(p);
      const flags = [];
      while (flags.length < np) {
        const f = b[p++];
        flags.push(f);
        if (f & 8) { let r = b[p++]; while (r--) flags.push(f); }
      }
      const xs = [], ys = [];
      let v = 0;
      for (const f of flags) {
        if (f & 2) { const d = b[p++]; v += f & 16 ? d : -d; }
        else if (!(f & 16)) { v += b.readInt16BE(p); p += 2; }
        xs.push(v);
      }
      v = 0;
      for (const f of flags) {
        if (f & 4) { const d = b[p++]; v += f & 32 ? d : -d; }
        else if (!(f & 32)) { v += b.readInt16BE(p); p += 2; }
        ys.push(v);
      }
      const orig = xs.map((x, i) => [x, ys[i]]);
      orig.push([0, 0], [adv, 0], [0, 0], [0, 0]);
      const dl = glyphDeltas(g, coords, orig, ends);
      const contours = [];
      let s = 0;
      for (const e of ends) {
        const c = [];
        for (let i = s; i <= e; i++) c.push({ x: xs[i] + dl[i][0], y: ys[i] + dl[i][1], on: !!(flags[i] & 1) });
        contours.push(c);
        s = e + 1;
      }
      return contours;
    }
    // composite
    const comps = [];
    let p = off + 10;
    while (true) {
      const fl = b.readUInt16BE(p), gi = b.readUInt16BE(p + 2);
      p += 4;
      let dx, dy;
      if (fl & 1) { dx = b.readInt16BE(p); dy = b.readInt16BE(p + 2); p += 4; }
      else { dx = b.readInt8(p); dy = b.readInt8(p + 1); p += 2; }
      if (!(fl & 2)) { dx = 0; dy = 0; }
      let m = [1, 0, 0, 1];
      if (fl & 8) { const s = f2(p); m = [s, 0, 0, s]; p += 2; }
      else if (fl & 0x40) { m = [f2(p), 0, 0, f2(p + 2)]; p += 4; }
      else if (fl & 0x80) { m = [f2(p), f2(p + 2), f2(p + 4), f2(p + 6)]; p += 8; }
      comps.push({ gi, dx, dy, m });
      if (!(fl & 0x20)) break;
    }
    const orig = comps.map((c) => [c.dx, c.dy]);
    orig.push([0, 0], [adv, 0], [0, 0], [0, 0]);
    const dl = glyphDeltas(g, coords, orig, null);
    const out = [];
    comps.forEach((c, i) => {
      for (const con of outline(c.gi, coords)) {
        out.push(con.map((pt) => ({
          x: c.m[0] * pt.x + c.m[2] * pt.y + c.dx + dl[i][0],
          y: c.m[1] * pt.x + c.m[3] * pt.y + c.dy + dl[i][1],
          on: pt.on,
        })));
      }
    });
    return out;
  }

  // SVG path data in font units, y flipped (y down), baseline at 0.
  function glyphPath(ch, axisValues = {}) {
    const g = cmap.get(ch.codePointAt(0)) ?? 0;
    const coords = normalize(axisValues);
    const r = (v) => Math.round(v);
    let d = "";
    for (const c of outline(g, coords)) {
      if (!c.length) continue;
      const pts = c.map((p) => ({ x: p.x, y: -p.y, on: p.on }));
      let startIdx = pts.findIndex((p) => p.on);
      let start;
      if (startIdx < 0) {
        start = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, on: true };
        startIdx = 0;
        pts.splice(1, 0, start);
        startIdx = 1;
      } else start = pts[startIdx];
      d += `M${r(start.x)} ${r(start.y)}`;
      const n = pts.length;
      let ctrl = null;
      for (let k = 1; k <= n; k++) {
        const p = pts[(startIdx + k) % n];
        if (p.on) {
          d += ctrl ? `Q${r(ctrl.x)} ${r(ctrl.y)} ${r(p.x)} ${r(p.y)}` : `L${r(p.x)} ${r(p.y)}`;
          ctrl = null;
        } else {
          if (ctrl) {
            const mx = (ctrl.x + p.x) / 2, my = (ctrl.y + p.y) / 2;
            d += `Q${r(ctrl.x)} ${r(ctrl.y)} ${r(mx)} ${r(my)}`;
          }
          ctrl = p;
        }
      }
      d += "Z";
    }
    return { d, advance: advance(g) };
  }

  return { upm, glyphPath, has: (ch) => cmap.has(ch.codePointAt(0)) };
}
