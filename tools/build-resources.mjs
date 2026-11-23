#!/usr/bin/env node
// Bundles everything under resources/ into js/resources.js so that index.html
// works when opened straight from disk (file://), where fetch() is blocked.
//
//  - .svg / .xml files are embedded as text.
//  - .ogg files are embedded as base64 data URLs (sounds; music if present).
//  - resources/font.ttf is parsed here and its glyph outlines (chars 0-255) are
//    emitted as SVG path data at 36px, which the engine renders with the same
//    sketchy renderer it uses for everything else (like the original, which
//    turned FreeType outlines into sketch paths).
//
// Usage: node tools/build-resources.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resDir = path.join(root, "resources");
const outFile = path.join(root, "js", "resources.js");
const FONT_SIZE = 36;

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else out.push(full);
    }
    return out;
}

/* ---------------------------------------------------------------------- */
/* Minimal TrueType parser: cmap (format 4), loca, glyf, hmtx.             */
/* ---------------------------------------------------------------------- */
function parseTTF(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const numTables = dv.getUint16(4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
        const o = 12 + i * 16;
        const tag = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
        tables[tag] = { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
    }
    const head = tables.head.offset;
    const unitsPerEm = dv.getUint16(head + 18);
    const indexToLocFormat = dv.getInt16(head + 50);
    const numGlyphs = dv.getUint16(tables.maxp.offset + 4);
    const numHMetrics = dv.getUint16(tables.hhea.offset + 34);

    const loca = [];
    for (let i = 0; i <= numGlyphs; i++) {
        loca.push(indexToLocFormat === 0
            ? dv.getUint16(tables.loca.offset + i * 2) * 2
            : dv.getUint32(tables.loca.offset + i * 4));
    }

    function advance(glyph) {
        const i = Math.min(glyph, numHMetrics - 1);
        return dv.getUint16(tables.hmtx.offset + i * 4);
    }

    // cmap: find a unicode format-4 subtable.
    const cmap = tables.cmap.offset;
    const nSub = dv.getUint16(cmap + 2);
    let sub = -1;
    for (let i = 0; i < nSub; i++) {
        const platform = dv.getUint16(cmap + 4 + i * 8);
        const encoding = dv.getUint16(cmap + 4 + i * 8 + 2);
        const off = dv.getUint32(cmap + 4 + i * 8 + 4);
        if (dv.getUint16(cmap + off) === 4 &&
                (platform === 0 || (platform === 3 && encoding === 1))) {
            sub = cmap + off;
            break;
        }
    }
    function glyphIndex(code) {
        if (sub < 0) return 0;
        const segX2 = dv.getUint16(sub + 6);
        const ends = sub + 14, starts = ends + segX2 + 2;
        const deltas = starts + segX2, ranges = deltas + segX2;
        for (let i = 0; i < segX2 / 2; i++) {
            const end = dv.getUint16(ends + i * 2);
            if (code > end) continue;
            const start = dv.getUint16(starts + i * 2);
            if (code < start) return 0;
            const delta = dv.getInt16(deltas + i * 2);
            const rangeOffset = dv.getUint16(ranges + i * 2);
            if (rangeOffset === 0) return (code + delta) & 0xffff;
            const addr = ranges + i * 2 + rangeOffset + (code - start) * 2;
            const g = dv.getUint16(addr);
            return g === 0 ? 0 : (g + delta) & 0xffff;
        }
        return 0;
    }

    // Returns contours: arrays of {x, y, on}.
    function contours(glyph, depth = 0) {
        const start = tables.glyf.offset + loca[glyph];
        const end = tables.glyf.offset + loca[glyph + 1];
        if (end <= start || depth > 8) return [];
        let p = start;
        const nContours = dv.getInt16(p);
        p += 10;
        if (nContours >= 0) {
            const endPts = [];
            for (let i = 0; i < nContours; i++) { endPts.push(dv.getUint16(p)); p += 2; }
            const nPoints = nContours ? endPts[nContours - 1] + 1 : 0;
            p += 2 + dv.getUint16(p); // instructions
            const flags = [];
            while (flags.length < nPoints) {
                const f = buf[p++];
                flags.push(f);
                if (f & 8) {
                    let r = buf[p++];
                    while (r-- > 0) flags.push(f);
                }
            }
            const xs = [], ys = [];
            let v = 0;
            for (const f of flags) {
                if (f & 2) { const d = buf[p++]; v += (f & 16) ? d : -d; }
                else if (!(f & 16)) { v += dv.getInt16(p); p += 2; }
                xs.push(v);
            }
            v = 0;
            for (const f of flags) {
                if (f & 4) { const d = buf[p++]; v += (f & 32) ? d : -d; }
                else if (!(f & 32)) { v += dv.getInt16(p); p += 2; }
                ys.push(v);
            }
            const result = [];
            let s = 0;
            for (const e of endPts) {
                const c = [];
                for (let i = s; i <= e; i++) c.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) });
                result.push(c);
                s = e + 1;
            }
            return result;
        }
        // Composite glyph (offsets only, scale ignored except simple scale).
        const result = [];
        let more = true;
        while (more) {
            const flags = dv.getUint16(p);
            const g = dv.getUint16(p + 2);
            p += 4;
            let dx, dy;
            if (flags & 1) { dx = dv.getInt16(p); dy = dv.getInt16(p + 2); p += 4; }
            else { dx = dv.getInt8(p); dy = dv.getInt8(p + 1); p += 2; }
            let sx = 1, sy = 1;
            if (flags & 8) { sx = sy = dv.getInt16(p) / 16384; p += 2; }
            else if (flags & 0x40) { sx = dv.getInt16(p) / 16384; sy = dv.getInt16(p + 2) / 16384; p += 4; }
            else if (flags & 0x80) { sx = dv.getInt16(p) / 16384; sy = dv.getInt16(p + 6) / 16384; p += 8; }
            for (const c of contours(g, depth + 1))
                result.push(c.map(pt => ({ x: pt.x * sx + dx, y: pt.y * sy + dy, on: pt.on })));
            more = !!(flags & 0x20);
        }
        return result;
    }

    return { unitsPerEm, glyphIndex, contours, advance };
}

function fmt(n) {
    return (Math.round(n * 1000) / 1000).toString();
}

// Converts TrueType contours to SVG path data in pixel space (y down). Each
// contour is explicitly closed with a segment back to its start point, since
// the engine's "z" handling (faithful to the original) does not close paths.
function contoursToPath(contours, scale) {
    const P = pt => ({ x: pt.x * scale, y: -pt.y * scale, on: pt.on });
    let d = "";
    for (const raw of contours) {
        if (raw.length < 2) continue;
        let pts = raw.map(P);
        // Rotate so the contour starts on an on-curve point.
        let first = pts.findIndex(p => p.on);
        if (first < 0) {
            const a = pts[0], b = pts[1];
            pts.unshift({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
            first = 0;
        }
        pts = pts.slice(first).concat(pts.slice(0, first));
        const start = pts[0];
        d += `M ${fmt(start.x)},${fmt(start.y)} `;
        let ctrl = null;
        for (let i = 1; i <= pts.length; i++) {
            const p = i === pts.length ? start : pts[i];
            if (p.on) {
                if (ctrl) d += `Q ${fmt(ctrl.x)},${fmt(ctrl.y)} ${fmt(p.x)},${fmt(p.y)} `;
                else d += `L ${fmt(p.x)},${fmt(p.y)} `;
                ctrl = null;
            } else {
                if (ctrl) {
                    const mx = (ctrl.x + p.x) / 2, my = (ctrl.y + p.y) / 2;
                    d += `Q ${fmt(ctrl.x)},${fmt(ctrl.y)} ${fmt(mx)},${fmt(my)} `;
                }
                ctrl = p;
            }
        }
    }
    return d.trim();
}

/* ---------------------------------------------------------------------- */

const files = {};
const sounds = {};
let font = null;

for (const full of walk(resDir).sort()) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    const ext = path.extname(full).toLowerCase();
    if (ext === ".svg" || ext === ".xml") {
        files[rel] = fs.readFileSync(full, "utf8");
    } else if (ext === ".ogg") {
        sounds[rel] = "data:audio/ogg;base64," + fs.readFileSync(full).toString("base64");
    } else if (rel === "resources/font.ttf") {
        const ttf = parseTTF(fs.readFileSync(full));
        const scale = FONT_SIZE / ttf.unitsPerEm;
        const glyphs = [];
        for (let c = 0; c < 256; c++) {
            const g = ttf.glyphIndex(c);
            glyphs.push({
                d: g ? contoursToPath(ttf.contours(g), scale) : "",
                advance: g ? Math.round(ttf.advance(g) * scale) : 0,
            });
        }
        font = { size: FONT_SIZE, glyphs };
    }
}

const out = "// Generated by tools/build-resources.mjs - do not edit.\n" +
    "window.JVGS_RESOURCES = " + JSON.stringify({ files, sounds, font }) + ";\n";
fs.writeFileSync(outFile, out);
console.log(`Wrote ${path.relative(root, outFile)}: ${Object.keys(files).length} files, ` +
    `${Object.keys(sounds).length} sounds, font ${font ? "yes" : "no"}, ` +
    `${(out.length / 1024 / 1024).toFixed(2)} MB`);
