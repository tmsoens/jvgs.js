// Loads the game's browser scripts into a fresh Node `vm` context with stand-ins
// for the browser APIs they touch (canvas, Path2D, Audio, localStorage, DOM
// events, DOMParser), so the real engine can be stepped and rendered headless.
//
// Math.random is replaced by a seeded generator, so a run with the same seed
// and the same input is fully deterministic.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DOMParser } from "./xml.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Same order as the <script> tags in index.html, minus main.js. */
export const ENGINE_SCRIPTS = [
    "js/resources.js", "js/math.js", "js/sketch.js", "js/platform.js",
    "js/effects.js", "js/game.js", "js/scripts.js",
];

const compiled = new Map();
function script(file) {
    if (!compiled.has(file)) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        compiled.set(file, new vm.Script(code, { filename: path.join(ROOT, file) }));
    }
    return compiled.get(file);
}

export const STEP = 1000 / 60;

/** mulberry32 */
function seededRandom(seed) {
    let a = seed >>> 0;
    return function random() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const round = v => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);

class Path2D {
    constructor() { this.ops = []; this.key = null; }
    moveTo(x, y) { this.ops.push("M", round(x), round(y)); this.key = null; }
    lineTo(x, y) { this.ops.push("L", round(x), round(y)); this.key = null; }
    toString() { return (this.key ??= this.ops.join(" ")); }
}

/** A 2D context that feeds every drawing call into a running hash. */
class RecordingContext {
    constructor() { this.reset(); }
    reset() {
        this.hash = crypto.createHash("sha256");
        this.strokes = 0;
    }
    record(name, ...args) { this.hash.update(name + "(" + args.map(round).join(",") + ")"); }
    setTransform(...a) { this.record("setTransform", ...a); }
    fillRect(...a) { this.record("fillRect", ...a, this.fillStyle); }
    save() { this.record("save"); }
    restore() { this.record("restore"); }
    translate(...a) { this.record("translate", ...a); }
    scale(...a) { this.record("scale", ...a); }
    rotate(...a) { this.record("rotate", ...a); }
    stroke(p) {
        this.strokes++;
        this.record("stroke", this.strokeStyle, this.lineWidth, String(p));
    }
    digest() { return this.hash.copy().digest("hex").slice(0, 16); }
}

class FakeAudio {
    constructor(src, log) { this.src = src; this.log = log; this.loop = false; this.paused = true; }
    cloneNode() { return new FakeAudio(this.src, this.log); }
    play() { this.paused = false; this.log.push(this.src); return Promise.resolve(); }
    pause() { this.paused = true; }
}

/**
 * @param {object} options
 * @param {number} [options.seed]       seed for Math.random
 * @param {object} [options.storage]    initial localStorage contents
 * @param {boolean} [options.main]      also run js/main.js (the real entry point)
 */
export function createGame({ seed = 1, storage = {}, main = false } = {}) {
    const logs = { log: [], info: [], warn: [], error: [] };
    const sounds = [];
    const listeners = new Map();
    const store = new Map(Object.entries(storage));
    const ctx2d = new RecordingContext();
    const animationFrames = [];
    let now = 0;

    const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx2d };
    const format = args => args.map(a => (typeof a === "string" ? a : String(a))).join(" ");

    const sandbox = {
        console: Object.fromEntries(Object.keys(logs).map(k => [k, (...a) => logs[k].push(format(a))])),
        DOMParser,
        Path2D,
        Audio: class extends FakeAudio { constructor(src) { super(src, sounds); } },
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k),
        },
        document: { getElementById: id => (id === "game" ? canvas : null) },
        innerWidth: 800,
        innerHeight: 600,
        devicePixelRatio: 1,
        performance: { now: () => now },
        requestAnimationFrame: cb => animationFrames.push(cb),
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    };
    const context = vm.createContext(sandbox);
    vm.runInContext("globalThis.window = globalThis;", context);
    context.__random = seededRandom(seed);
    vm.runInContext("Math.random = globalThis.__random;", context);

    for (const file of ENGINE_SCRIPTS) script(file).runInContext(context);

    /** Reads a top-level binding (const/class/function) of the game scripts. */
    const get = name => vm.runInContext(name, context);
    // Report played sounds by resource name rather than data URL.
    const soundNames = new Map(Object.entries(get("window.JVGS_RESOURCES.sounds")).map(([k, v]) => [v, k]));
    const LevelManager = get("LevelManager");
    const InputManager = get("InputManager");
    const InputConfiguration = get("InputConfiguration");

    const codes = key => {
        const mapped = InputConfiguration.getKey(key);
        return mapped.length ? [mapped[0]] : [key];
    };

    const game = {
        context, get, logs, storage: store,
        /** Resource names of the sounds played so far. */
        sounds: () => sounds.map(src => soundNames.get(src) ?? src),
        ctx2d, canvas,
        LevelManager, InputManager,

        /** Queues and loads a level file, like the game does between frames. */
        load(fileName) {
            LevelManager.queueLevel(fileName);
            LevelManager.processQueue();
            return LevelManager.getLevel();
        },
        level() { return LevelManager.getLevel(); },
        entity(id) { return LevelManager.getLevel()?.getEntityById(id) ?? null; },
        player() { return game.entity("player"); },
        /** File name of the level that was most recently loaded or queued. */
        queuedLevel() { return LevelManager.queue ? LevelManager.queueFileName : null; },

        /** Advances the simulation by `count` fixed 60 Hz steps. */
        step(count = 1) {
            for (let i = 0; i < count; i++) LevelManager.step(STEP);
        },
        /** Steps for roughly `ms` of game time, stopping early once `until()` holds. */
        run(ms, until = () => false) {
            const steps = Math.ceil(ms / STEP);
            for (let i = 0; i < steps; i++) {
                LevelManager.step(STEP);
                if (until()) return true;
            }
            return until();
        },

        // Input, by InputConfiguration name ("left", "jump", "action", ...)
        // or by KeyboardEvent.code.
        hold(...keys) { for (const k of keys) for (const c of codes(k)) InputManager.down.add(c); },
        release(...keys) { for (const k of keys) for (const c of codes(k)) InputManager.down.delete(c); },
        releaseAll() { InputManager.down.clear(); },
        tap(...keys) { for (const k of keys) for (const c of codes(k)) InputManager.pendingTicks.add(c); },

        /** Renders one frame and returns a short hash of every drawing call. */
        render() {
            ctx2d.reset();
            LevelManager.render(get("VideoManager"));
            return ctx2d.digest();
        },

        /** Moves an entity (default: the player) onto another entity. */
        teleport(targetId, entity = game.player()) {
            const target = game.entity(targetId);
            if (!target) throw new Error("No entity " + targetId);
            entity.setPosition(target.getPosition());
            entity.setVelocity(new (get("Vector2D"))(0, 0));
        },

        dispatch(type, event) {
            for (const fn of [...(listeners.get(type) ?? [])])
                fn({ preventDefault() {}, repeat: false, ...event });
        },
        /** Runs the next queued requestAnimationFrame callback (main: true). */
        frame(ms = STEP) {
            now += ms;
            const cb = animationFrames.shift();
            if (cb) cb(now);
            return !!cb;
        },
        pendingFrames() { return animationFrames.length; },
    };

    if (main) {
        script("js/main.js").runInContext(context);
    } else {
        // The same setup main.js does, without starting the loop or a level.
        vm.runInContext(`
            VideoManager.init(document.getElementById("game"));
            InputManager.init();
            PersistenceManager.load();
            FontManager.addFont("regular", new Font(window.JVGS_RESOURCES.font));
        `, context);
    }
    return game;
}

/** A plain, comparable summary of an entity's state. */
export function entityState(entity) {
    const r = v => Math.round(v * 100) / 100;
    return {
        id: entity.getId(),
        x: r(entity.getPosition().x),
        y: r(entity.getPosition().y),
        vx: r(entity.getVelocity().x),
        vy: r(entity.getVelocity().y),
        health: entity.isSet("health") ? entity.get("health") : null,
    };
}

export function levelState(game) {
    const level = game.level();
    const entities = [];
    for (let i = 0; i < level.getNumberOfEntities(); i++) entities.push(entityState(level.getEntity(i)));
    return entities;
}

let bundleCache = null;
/** The parsed contents of js/resources.js: { files, sounds, font }. */
export function bundle() {
    if (!bundleCache) {
        const sandbox = { window: {} };
        script("js/resources.js").runInContext(vm.createContext(sandbox));
        bundleCache = sandbox.window.JVGS_RESOURCES;
    }
    return bundleCache;
}

/** All bundled XML files whose root element is <level>. */
export function levelFiles() {
    const { files } = bundle();
    const parser = new DOMParser();
    return Object.keys(files)
        .filter(f => f.endsWith(".xml"))
        .filter(f => parser.parseFromString(files[f]).documentElement.tagName === "level")
        .sort();
}
