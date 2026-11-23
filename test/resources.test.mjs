// Static checks on resources/ and the generated bundle: everything the XML
// and scripts refer to must exist, and js/resources.js must be up to date.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, bundle, createGame } from "./support/game.mjs";
import { DOMParser } from "./support/xml.mjs";

const { files, sounds, font } = bundle();
const parser = new DOMParser();

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : [full];
    });
}
const onDisk = walk(path.join(ROOT, "resources")).map(f => path.relative(ROOT, f).split(path.sep).join("/"));

function parse(file) {
    const doc = parser.parseFromString(files[file]);
    const error = doc.querySelector("parsererror");
    if (error) throw new Error(`${file}: ${error.textContent}`);
    return doc.documentElement;
}
function* elements(root) {
    yield root;
    for (const child of root.children) yield* elements(child);
}
const xmlFiles = Object.keys(files).filter(f => f.endsWith(".xml")).sort();

/** [file, element, attribute, value] for every attribute in the game XML. */
const attributes = xmlFiles.flatMap(file =>
    [...elements(parse(file))].flatMap(el =>
        [...el.attributes].map(([name, value]) => ({ file, el, name, value }))));

test("js/resources.js is up to date with resources/ (run node tools/build-resources.mjs)", () => {
    const textOnDisk = onDisk.filter(f => /\.(svg|xml)$/.test(f)).sort();
    assert.deepEqual(Object.keys(files).sort(), textOnDisk);
    for (const f of textOnDisk)
        assert.equal(files[f], fs.readFileSync(path.join(ROOT, f), "utf8"), `${f} differs from the bundle`);
    assert.deepEqual(Object.keys(sounds).sort(), onDisk.filter(f => f.endsWith(".ogg")).sort());
    assert.ok(font && font.glyphs.length >= 128, "font glyphs are bundled");
});

test("every bundled XML and SVG file is well-formed", () => {
    for (const file of Object.keys(files)) parse(file);
});

test("file references in the XML point at bundled files", () => {
    for (const { file, name, value } of attributes) {
        if (["filename", "sketch", "world"].includes(name))
            assert.ok(value in files, `${file}: ${name}="${value}" does not exist`);
    }
});

test("sounds referenced from entity entries are bundled", () => {
    const refs = attributes.filter(a => a.el.tagName === "entry" && a.name === "value" && a.value.endsWith(".ogg"));
    assert.ok(refs.length > 0);
    for (const { file, value } of refs) assert.ok(value in sounds, `${file}: sound ${value} is not bundled`);
});

test("music references follow resources/music/<name>.ogg", () => {
    // The music was never in the original repository, so it may be absent.
    for (const { file, name, value } of attributes.filter(a => a.name === "music"))
        assert.match(value, /^resources\/music\/[\w-]+\.ogg$/, `${file}: ${name}="${value}"`);
});

test("resource paths used in the scripts exist", () => {
    for (const js of ["js/scripts.js", "js/main.js"]) {
        const source = fs.readFileSync(path.join(ROOT, js), "utf8");
        for (const [, ref] of source.matchAll(/"(resources\/[^"$]+)"/g)) {
            if (ref.endsWith("/")) {
                // A directory prefix completed at runtime, e.g. "resources/effects/" + name.
                assert.ok(Object.keys(files).some(f => f.startsWith(ref)), `${js}: nothing under ${ref}`);
            } else if (ref.endsWith(".ogg")) assert.ok(ref in sounds, `${js}: ${ref} is not bundled`);
            else assert.ok(ref in files, `${js}: ${ref} does not exist`);
        }
        // Template literals like `resources/player/${weapon}-sprite.xml`.
        for (const [, prefix, suffix] of source.matchAll(/`(resources\/[^`$]*)\$\{[^}]+\}([^`]*)`/g)) {
            const matching = Object.keys(files).filter(f => f.startsWith(prefix) && f.endsWith(suffix));
            assert.ok(matching.length > 0, `${js}: nothing matches ${prefix}*${suffix}`);
        }
    }
});

test("weapon sprites exist for every weapon pickup", () => {
    const weapons = ["knife", "grenade", "hat", "clock"];
    for (const w of weapons) assert.ok(`resources/player/${w}-sprite.xml` in files, w);
});

test("script ids in the XML are registered, and every registered script is used", () => {
    const game = createGame();
    const registered = Object.keys(game.get("ScriptManager").scripts).sort();
    const used = [...new Set(attributes.filter(a => a.name === "script").map(a => a.value))].sort();
    for (const id of used) {
        assert.doesNotMatch(id, /\.lua$|^resources\//, `script ids are plain ids, not paths: ${id}`);
        assert.ok(registered.includes(id), `script "${id}" is used in the XML but not registered`);
    }
    assert.deepEqual(registered, used, "registered scripts that no XML uses");
});

test("controller, positioner and camera types are known", () => {
    const game = createGame();
    const known = {
        controller: Object.keys(game.get("controllerFactories")),
        positioner: Object.keys(game.get("positionerFactories")),
        camera: Object.keys(game.get("cameraFactories")),
    };
    for (const { file, el, name, value } of attributes) {
        if (name === "type" && el.tagName in known)
            assert.ok(known[el.tagName].includes(value), `${file}: unknown ${el.tagName} type "${value}"`);
    }
});

test("entity ids are unique within a level", () => {
    for (const file of xmlFiles) {
        const root = parse(file);
        if (root.tagName !== "level") continue;
        const ids = root.children.filter(c => c.tagName === "entity").map(e => e.getAttribute("id")).filter(Boolean);
        assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], `${file} has duplicate entity ids`);
    }
});
