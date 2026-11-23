// jvgs::sketch + the sketchy renderer - port of src/sketch/*.cpp and
// src/video/SketchyRenderer.cpp.
//
// Like the original (which compiled every path into an OpenGL display list
// once, at load time), every path is "sketchified" exactly once into a Path2D
// and that same Path2D is stroked every frame.
"use strict";

const Resources = {
    text(fileName) {
        const t = window.JVGS_RESOURCES.files[fileName];
        if (t === undefined) throw new Error("Could not load resource: " + fileName);
        return t;
    },
    xml(fileName) {
        const doc = new DOMParser().parseFromString(this.text(fileName), "application/xml");
        const err = doc.querySelector("parsererror");
        if (err) throw new Error("Could not parse xml document " + fileName + ": " + err.textContent);
        return doc.documentElement;
    },
};

/** Smooth 1D value noise. Port of math/Noise.cpp. */
class Noise {
    constructor(min, max, waveLength) {
        this.min = min; this.max = max; this.waveLength = waveLength;
        this.seed();
    }
    seed() {
        this.current = MathManager.randFloat(this.min, this.max);
        this.next = MathManager.randFloat(this.min, this.max);
        this.position = 0;
    }
    nextValue() {
        const t = this.position / this.waveLength;
        const value = ((this.current + this.next) + (this.current - this.next) * Math.cos(Math.PI * t)) * 0.5;
        this.position++;
        if (this.position >= this.waveLength) {
            this.position = 0;
            this.current = this.next;
            this.next = MathManager.randFloat(this.min, this.max);
        }
        return value;
    }
}

/**
 * Renderer interface: begin(), vector(v), end(). The SketchyRenderer draws
 * each line strip 1-9 times: once in full and then random sub-ranges, all
 * displaced by smooth noise. Output is appended to a Path2D.
 */
class SketchyRenderer {
    constructor(path2d) {
        this.path2d = path2d;
        this.noiseX = new Noise(-2, 2, 5);
        this.noiseY = new Noise(-2, 2, 5);
        this.vectorList = [];
    }
    begin() {
        this.vectorList = [];
        this.noiseX.seed();
        this.noiseY.seed();
    }
    vector(v) { this.vectorList.push(v); }
    end() {
        const list = this.vectorList;
        let repeat = MathManager.randInt(1, 10);
        let start = 0, end = list.length;
        while (repeat > 0) {
            for (let i = start; i < end; i++) {
                const x = list[i].x + this.noiseX.nextValue();
                const y = list[i].y + this.noiseY.nextValue();
                if (i === start) this.path2d.moveTo(x, y);
                else this.path2d.lineTo(x, y);
            }
            start = MathManager.randInt(0, list.length);
            end = MathManager.randInt(0, list.length);
            if (start > end) { const t = end; end = start; start = t; }
            repeat--;
        }
        this.vectorList = [];
    }
}

/** Collects all vertices (used for bounding boxes). */
class DataRenderer {
    constructor() { this.data = []; }
    begin() {}
    vector(v) { this.data.push(v); }
    end() {}
}

class SketchElement {
    constructor(parent) {
        this.parent = parent;
        this.matrix = new AffineTransformationMatrix();
        this.id = "none";
    }
    getId() { return this.id; }
    /** Faithful to the original: own matrix multiplied by the ancestors'. */
    getCompleteMatrix() {
        const complete = this.matrix.clone();
        let element = this.parent;
        while (element) {
            complete.multiply(element.matrix);
            element = element.parent;
        }
        return complete;
    }
}

class Group extends SketchElement {
    constructor(parent) {
        super(parent);
        this.elements = [];
    }
    addSketchElement(e) { this.elements.push(e); }
    finnish() { for (const e of this.elements) e.finnish(); }
    render(video) { for (const e of this.elements) e.render(video); }
    renderWith(renderer) { for (const e of this.elements) e.renderWith(renderer); }
}

class PathComponent {
    constructor(path) {
        this.path = path;
        this.segments = [];
    }
    addSegment(s) { this.segments.push(s); }
    renderWith(renderer) {
        renderer.begin();
        for (const segment of this.segments) {
            const increment = Path.SUBDIVIDE_LENGTH / segment.getLength();
            renderer.vector(segment.getPoint(0));
            for (let t = increment; t < 1; t += increment) renderer.vector(segment.getPoint(t));
            renderer.vector(segment.getPoint(1));
        }
        renderer.end();
    }
}

class Path extends SketchElement {
    constructor(parent) {
        super(parent);
        this.components = [];
        this.boundingBox = null;
        this.path2d = null;
    }
    addComponent(c) { this.components.push(c); }
    finnish() {
        this.path2d = new Path2D();
        this.renderWith(new SketchyRenderer(this.path2d));
        const data = new DataRenderer();
        this.renderWith(data);
        if (data.data.length >= 2) this.boundingBox = BoundingBox.fromPoints(data.data);
    }
    getBoundingBox() { return this.boundingBox; }
    render(video) { video.strokePath(this.path2d); }
    renderWith(renderer) { for (const c of this.components) c.renderWith(renderer); }
}
Path.SUBDIVIDE_LENGTH = 5;

/* ---------------------------------------------------------------------- */
/* Parsing                                                                 */
/* ---------------------------------------------------------------------- */

function parseNumbers(str) {
    // Same trick as the original: split "123-456" into "123 -456" while
    // leaving exponents like "1e-5" alone.
    str = str.replace(/e-/g, "e#").replace(/-/g, " -").replace(/e#/g, "e-");
    return str.split(/[\s,]+/).filter(s => s.length).map(s => parseFloat(s));
}

const TransformParser = {
    commands: {
        rotate(m, a) {
            if (a.length === 1) m.rotate(a[0]);
            else if (a.length === 3) m.rotate(a[0], new Vector2D(a[1], a[2]));
        },
        scale(m, a) {
            if (a.length === 1) m.scale(new Vector2D(a[0], a[0]));
            else if (a.length === 2) m.scale(new Vector2D(a[0], a[1]));
        },
        translate(m, a) {
            if (a.length === 1) m.translate(new Vector2D(a[0], 0));
            else if (a.length === 2) m.translate(new Vector2D(a[0], a[1]));
        },
        matrix(m, a) {
            if (a.length === 6) m.multiply(new AffineTransformationMatrix(a[0], a[2], a[4], a[1], a[3], a[5]));
        },
        skewX(m, a) { if (a.length === 1) m.skewX(a[0]); },
        skewY(m, a) { if (a.length === 1) m.skewY(a[0]); },
    },
    parse(data) {
        const matrix = new AffineTransformationMatrix();
        const re = /([A-Za-z]+)\s*\(([^)]*)\)/g;
        let match;
        while ((match = re.exec(data))) {
            const command = this.commands[match[1]];
            const args = match[2].split(/[\s,]+/).filter(s => s.length).map(parseFloat);
            if (command) command(matrix, args);
            else console.warn(`Unknown transform command "${match[1]}"`);
        }
        return matrix;
    },
};

/** Parses SVG path data into components/segments in world space. */
class PathDataParser {
    constructor(path, data) {
        this.path = path;
        this.data = data;
        this.currentComponent = null;
        this.startingPoint = new Vector2D();
        this.currentPoint = new Vector2D();
        this.lastControlPoint = new Vector2D();
        this.matrix = path.getCompleteMatrix();
    }
    isRelative(c) { return c >= "a" && c <= "z"; }
    abs(c, v) { return this.isRelative(c) ? v.add(this.currentPoint) : v; }
    world(v) { return this.matrix.apply(v); }
    addSegment(s) {
        if (!this.currentComponent) {
            // Path data that does not start with M; be lenient.
            this.currentComponent = new PathComponent(this.path);
            this.path.addComponent(this.currentComponent);
        }
        this.currentComponent.addSegment(s);
    }
    parse() {
        const re = /[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g;
        const commands = this.data.match(re) || [];
        for (const cmd of commands) this.command(cmd[0], parseNumbers(cmd.slice(1)));
    }
    command(c, a) {
        switch (c.toLowerCase()) {
            case "m": this.m(c, a); break;
            case "l": this.l(c, a); break;
            case "c": this.c(c, a); break;
            case "s": this.s(c, a); break;
            case "q": this.q(c, a); break;
            case "t": this.t(c, a); break;
            case "a": this.a(c, a); break;
            case "z": this.z(); break;
            default:
                // H and V were never implemented in the original either.
                console.warn(c + " path command is not implemented.");
        }
    }
    m(c, a) {
        if (a.length < 2) return;
        const p = this.abs(c, new Vector2D(a[0], a[1]));
        this.startingPoint = p;
        this.currentPoint = p;
        this.lastControlPoint = p;
        this.currentComponent = new PathComponent(this.path);
        this.path.addComponent(this.currentComponent);
        const lc = this.isRelative(c) ? "l" : "L";
        for (let i = 2; i + 1 < a.length; i += 2) this.l(lc, [a[i], a[i + 1]]);
    }
    l(c, a) {
        for (let i = 0; i + 1 < a.length; i += 2) {
            const previous = this.currentPoint;
            const current = this.abs(c, new Vector2D(a[i], a[i + 1]));
            this.addSegment(new LineSegment(this.world(previous), this.world(current)));
            this.currentPoint = current;
        }
        this.lastControlPoint = this.currentPoint;
    }
    c(c, a) {
        for (let i = 0; i + 5 < a.length; i += 6) {
            const previous = this.currentPoint;
            const c1 = this.abs(c, new Vector2D(a[i], a[i + 1]));
            const c2 = this.abs(c, new Vector2D(a[i + 2], a[i + 3]));
            const current = this.abs(c, new Vector2D(a[i + 4], a[i + 5]));
            this.addSegment(new CubicCurve(this.world(previous), this.world(c1),
                                           this.world(c2), this.world(current)));
            this.lastControlPoint = c2;
            this.currentPoint = current;
        }
    }
    s(c, a) {
        const rel = this.isRelative(c);
        for (let i = 0; i + 3 < a.length; i += 4) {
            let c1 = this.currentPoint.reflect(this.lastControlPoint);
            if (rel) c1 = c1.sub(this.currentPoint);
            this.c(rel ? "c" : "C", [c1.x, c1.y, a[i], a[i + 1], a[i + 2], a[i + 3]]);
        }
    }
    q(c, a) {
        for (let i = 0; i + 3 < a.length; i += 4) {
            const previous = this.currentPoint;
            const control = this.abs(c, new Vector2D(a[i], a[i + 1]));
            const current = this.abs(c, new Vector2D(a[i + 2], a[i + 3]));
            this.addSegment(new QuadraticCurve(this.world(previous), this.world(control), this.world(current)));
            this.lastControlPoint = control;
            this.currentPoint = current;
        }
    }
    t(c, a) {
        const rel = this.isRelative(c);
        for (let i = 0; i + 1 < a.length; i += 2) {
            let control = this.currentPoint.reflect(this.lastControlPoint);
            if (rel) control = control.sub(this.currentPoint);
            this.q(rel ? "q" : "Q", [control.x, control.y, a[i], a[i + 1]]);
        }
    }
    a(c, a) {
        for (let i = 0; i + 6 < a.length; i += 7) {
            const start = this.currentPoint;
            const radius = new Vector2D(a[i], a[i + 1]);
            const end = this.abs(c, new Vector2D(a[i + 5], a[i + 6]));
            this.addSegment(new EllipticalArc(this.world(start), radius, a[i + 2],
                                              !!(a[i + 3] | 0), !!(a[i + 4] | 0), this.world(end)));
            this.currentPoint = end;
        }
        this.lastControlPoint = this.currentPoint;
    }
    z() {
        // Faithful to the original ZPathCommandParser: it draws a line to the
        // *current* point, so "z" never actually closes the path. The game's
        // SVGs close their shapes explicitly, so this is harmless.
        this.l("L", [this.currentPoint.x, this.currentPoint.y]);
    }
}

function parseGroup(parent, element) {
    const group = new Group(parent);
    parseAttributes(group, element);
    for (const child of element.children) {
        const e = parseSketchElement(group, child);
        if (e) group.addSketchElement(e);
    }
    return group;
}

/** Only <g> and <path> are understood, like the original parser. */
function parseSketchElement(parent, element) {
    const tag = element.tagName;
    if (tag === "g") {
        return parseGroup(parent, element);
    } else if (tag === "path") {
        const path = new Path(parent);
        parseAttributes(path, element);
        new PathDataParser(path, element.getAttribute("d") || "").parse();
        return path;
    }
    return null;
}

function parseAttributes(sketchElement, xml) {
    const transform = xml.getAttribute("transform");
    if (transform) sketchElement.matrix = TransformParser.parse(transform);
    const id = xml.getAttribute("id");
    if (id) sketchElement.id = id;
}

class Sketch {
    /** Either a resource file name, or a {root, size} object. */
    constructor(fileName) {
        this.fileName = fileName;
        this.ids = new Map();
        this.boundedObjects = [];
        const root = Resources.xml(fileName);
        this.size = new Vector2D(parseFloat(root.getAttribute("width")) || 0,
                                 parseFloat(root.getAttribute("height")) || 0);
        this.root = parseGroup(null, root);
        this.finnish();
    }
    static fromPathData(d) {
        const sketch = Object.create(Sketch.prototype);
        sketch.fileName = "not loaded from file";
        sketch.ids = new Map();
        sketch.boundedObjects = [];
        sketch.size = new Vector2D();
        sketch.root = new Group(null);
        const path = new Path(sketch.root);
        new PathDataParser(path, d).parse();
        sketch.root.addSketchElement(path);
        sketch.finnish();
        return sketch;
    }
    getSize() { return this.size; }
    getRoot() { return this.root; }
    getElementById(id) { return this.ids.get(id) || null; }
    finnish() {
        this.root.finnish();
        this.processElements(this.root);
        this.tree = new QuadTree(this.boundedObjects, 100);
    }
    processElements(group) {
        for (const element of group.elements) {
            this.ids.set(element.id, element);
            if (element instanceof Path) this.boundedObjects.push(element);
            if (element instanceof Group) this.processElements(element);
        }
    }
    /** Renders everything, or only the paths visible in a bounding box. */
    render(video, boundingBox) {
        if (!boundingBox) {
            this.root.render(video);
            return;
        }
        for (const path of this.tree.findObjects(boundingBox, [])) path.render(video);
    }
}

const SketchManager = {
    sketches: new Map(),
    getSketch(fileName) {
        let sketch = this.sketches.get(fileName);
        if (!sketch) {
            sketch = new Sketch(fileName);
            this.sketches.set(fileName, sketch);
        }
        return sketch;
    },
    clear() { this.sketches.clear(); },
};
