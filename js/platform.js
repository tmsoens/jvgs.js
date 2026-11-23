// Platform layer: replaces SDL/OpenGL/SDL_mixer/FreeType with canvas, DOM
// events, HTMLAudioElement and localStorage.
// Ports of video/VideoManager, input/InputManager, audio/AudioManager,
// core/PersistenceManager and font/Font.
"use strict";

class Color {
    constructor(r = 0, g = 0, b = 0, a = 1) { this.red = r; this.green = g; this.blue = b; this.alpha = a; }
    clone() { return new Color(this.red, this.green, this.blue, this.alpha); }
    css() {
        const c = v => Math.round(MathManager.clamp(v, 0, 1) * 255);
        return `rgba(${c(this.red)},${c(this.green)},${c(this.blue)},${MathManager.clamp(this.alpha, 0, 1)})`;
    }
}

const VideoManager = {
    canvas: null,
    ctx: null,
    dpr: 1,
    size: new Vector2D(800, 600),
    color: new Color(0, 0, 0),
    clearColor: new Color(1, 1, 1),
    lineWidth: 1.5,

    init(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        const resize = () => {
            this.dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth, h = window.innerHeight;
            canvas.style.width = w + "px";
            canvas.style.height = h + "px";
            canvas.width = Math.round(w * this.dpr);
            canvas.height = Math.round(h * this.dpr);
            this.size = new Vector2D(w, h);
        };
        window.addEventListener("resize", resize);
        resize();
    },
    getSize() { return this.size; },
    clear() {
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = this.clearColor.css();
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    },
    identity() {
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    },
    push() { this.ctx.save(); },
    pop() { this.ctx.restore(); },
    translate(v) { this.ctx.translate(v.x, v.y); },
    scale(v) { this.ctx.scale(v.x, v.y); },
    rotate(degrees) { this.ctx.rotate(degrees * Math.PI / 180); },
    strokePath(path2d) {
        const ctx = this.ctx;
        ctx.strokeStyle = this.color.css();
        // glLineWidth is independent of the modelview transform; the canvas
        // one is not, but all transforms used here have unit scale.
        ctx.lineWidth = this.lineWidth;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke(path2d);
    },
    setColor(c) { this.color = c.clone(); },
    getColor() { return this.color.clone(); },
    setClearColor(c) { this.clearColor = c.clone(); },
    getClearColor() { return this.clearColor.clone(); },
    invert() {
        const tmp = this.color;
        this.color = this.clearColor;
        this.clearColor = tmp;
    },
};

/** Key names used by InputConfiguration, mapped to KeyboardEvent.code. */
const InputConfiguration = {
    keys: {
        jump: ["Space"],
        // The original used left ctrl only. On macOS ctrl+arrows is often
        // grabbed by the OS, so X / Z also work.
        action: ["ControlLeft", "KeyX", "KeyZ"],
        left: ["ArrowLeft"],
        right: ["ArrowRight"],
        up: ["ArrowUp"],
        down: ["ArrowDown"],
    },
    getKey(name) { return this.keys[name] || []; },
};

const InputManager = {
    down: new Set(),
    pendingTicks: new Set(),
    ticked: new Set(),
    quitEvent: false,

    init() {
        const handled = new Set(["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
                                 "ControlLeft", "KeyX", "KeyZ", "Escape"]);
        window.addEventListener("keydown", e => {
            if (handled.has(e.code)) e.preventDefault();
            AudioManager.unlock();
            if (e.code === "Escape") {
                this.quitEvent = true;
                return;
            }
            this.down.add(e.code);
            if (!e.repeat) this.pendingTicks.add(e.code);
        });
        window.addEventListener("keyup", e => {
            if (handled.has(e.code)) e.preventDefault();
            this.down.delete(e.code);
        });
        window.addEventListener("blur", () => this.down.clear());
    },
    /** Called once per game step: ticks are the presses since last step. */
    update() {
        this.ticked = this.pendingTicks;
        this.pendingTicks = new Set();
    },
    isKeyDown(codes) { return codes.some(c => this.down.has(c)); },
    isKeyTicked(codes) { return codes.some(c => this.ticked.has(c)); },
    hasQuitEvent() { return this.quitEvent; },
    sendQuitEvent() { this.quitEvent = true; },
};

const AudioManager = {
    music: null,
    unlocked: false,
    pendingMusic: null,
    pool: new Map(),

    unlock() {
        if (this.unlocked) return;
        this.unlocked = true;
        if (this.pendingMusic) {
            const m = this.pendingMusic;
            this.pendingMusic = null;
            this.playMusic(m);
        }
    },
    source(fileName) {
        return window.JVGS_RESOURCES.sounds[fileName] || null;
    },
    playSound(fileName) {
        const src = this.source(fileName);
        if (!src) return;
        let base = this.pool.get(fileName);
        if (!base) {
            base = new Audio(src);
            this.pool.set(fileName, base);
        }
        const a = base.cloneNode();
        a.play().catch(() => {});
    },
    stopMusic() {
        this.pendingMusic = null;
        if (this.music) {
            this.music.pause();
            this.music = null;
        }
    },
    playMusic(fileName) {
        this.stopMusic();
        const src = this.source(fileName);
        if (!src) {
            // The music files were never part of the git repository.
            console.warn(`Could not open music ${fileName}.`);
            return;
        }
        if (!this.unlocked) {
            this.pendingMusic = fileName;
            return;
        }
        this.music = new Audio(src);
        this.music.loop = true;
        this.music.play().catch(() => {});
    },
};

/** Replaces ~/.jvgs.xml with localStorage. */
const PersistenceManager = {
    KEY: "jvgs",
    entries: {},
    load() {
        try {
            this.entries = JSON.parse(localStorage.getItem(this.KEY) || "{}") || {};
        } catch (e) {
            this.entries = {};
        }
    },
    write() {
        try {
            localStorage.setItem(this.KEY, JSON.stringify(this.entries));
        } catch (e) { /* storage unavailable */ }
    },
    isSet(key) { return Object.prototype.hasOwnProperty.call(this.entries, key); },
    get(key) { return this.isSet(key) ? this.entries[key] : ""; },
    set(key, value) { this.entries[key] = String(value); this.write(); },
};

/**
 * Outline font: glyphs come pre-extracted from resources/font.ttf (see
 * tools/build-resources.mjs) and are sketchified once, like the original
 * which turned FreeType outlines into sketchy display lists at startup.
 */
class Font {
    constructor(data) {
        this.size = data.size;
        this.glyphs = data.glyphs.map(g => ({
            sketch: g.d ? Sketch.fromPathData(g.d) : null,
            advance: g.advance,
        }));
    }
    glyph(ch) {
        const code = ch.charCodeAt(0);
        return code < this.glyphs.length ? this.glyphs[code] : null;
    }
    getStringWidth(str) {
        let width = 0;
        for (const ch of str) {
            const g = this.glyph(ch);
            if (g) width += g.advance;
        }
        return width;
    }
    drawString(video, str) {
        video.push();
        for (const ch of str) {
            const g = this.glyph(ch);
            if (!g) continue;
            if (g.sketch) g.sketch.render(video);
            video.translate(new Vector2D(g.advance, 0));
        }
        video.pop();
    }
}

const FontManager = {
    fonts: new Map(),
    addFont(name, font) { this.fonts.set(name, font); },
    getFont(name) { return this.fonts.get(name) || null; },
};
