// jvgs::math - port of src/math/*.cpp
"use strict";

class Vector2D {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    getX() { return this.x; }
    getY() { return this.y; }
    setX(x) { this.x = x; }
    setY(y) { this.y = y; }
    clone() { return new Vector2D(this.x, this.y); }
    add(o) { return new Vector2D(this.x + o.x, this.y + o.y); }
    sub(o) { return new Vector2D(this.x - o.x, this.y - o.y); }
    mul(s) { return new Vector2D(this.x * s, this.y * s); }
    div(s) { return new Vector2D(this.x / s, this.y / s); }
    neg() { return new Vector2D(-this.x, -this.y); }
    dot(o) { return this.x * o.x + this.y * o.y; }
    onlyX() { return new Vector2D(this.x, 0); }
    onlyY() { return new Vector2D(0, this.y); }
    getSquaredLength() { return this.x * this.x + this.y * this.y; }
    getLength() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    /** Mutating, like the C++ version. */
    setLength(length) {
        const l = this.getLength();
        if (l !== 0) {
            this.x = this.x / l * length;
            this.y = this.y / l * length;
        }
        return this;
    }
    /** Non-mutating convenience. */
    withLength(length) { return this.clone().setLength(length); }
    getDistance(o) {
        const dx = this.x - o.x, dy = this.y - o.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    normalized() { return this.div(this.getLength()); }
    reflect(o) { return this.mul(2).sub(o); }
    getAngle(o) {
        let abs = Math.acos(this.normalized().dot(o.normalized()));
        abs = 180 * abs / Math.PI;
        return this.x * o.y - this.y * o.x >= 0 ? abs : -abs;
    }
    static fromXML(element, vector) {
        if (element) {
            const x = element.getAttribute("x"), y = element.getAttribute("y");
            if (x !== null && !isNaN(parseFloat(x))) vector.x = parseFloat(x);
            if (y !== null && !isNaN(parseFloat(y))) vector.y = parseFloat(y);
        }
    }
    static fromPolar(radius, theta) {
        const r = MathManager.toRadians(theta);
        return new Vector2D(radius * Math.cos(r), radius * Math.sin(r));
    }
}

const MathManager = {
    randInt(min, max) {
        if (max === undefined) return Math.floor(Math.random() * min);
        if (min === max) return min;
        return min + Math.floor(Math.random() * (max - min));
    },
    randFloat(min, max) {
        if (min === undefined) return Math.random();
        if (max === undefined) return Math.random() * min;
        return min + Math.random() * (max - min);
    },
    randBool(chance = 0.5) { return Math.random() < chance; },
    clamp(a, lower, upper) { return a < lower ? lower : (a > upper ? upper : a); },
    toRadians(degrees) { return degrees * Math.PI / 180; },
    /** Returns the lowest root in [0, treshold] or null. */
    getLowestPositiveRoot(a, b, c, treshold) {
        const d = b * b - 4 * a * c;
        if (d < 0) return null;
        const sqrtD = Math.sqrt(d);
        let x1 = (-b - sqrtD) / (2 * a);
        let x2 = (-b + sqrtD) / (2 * a);
        if (x1 > x2) { const t = x1; x1 = x2; x2 = t; }
        if (x1 >= 0 && x1 <= treshold) return x1;
        if (x2 >= 0 && x2 <= treshold) return x2;
        return null;
    },
};

/**
 * 2D affine transformation matrix
 *   / a b c \
 *   | d e f |
 *   \ 0 0 1 /
 * Mutating operations post-multiply (this = this * other) like the C++ code.
 */
class AffineTransformationMatrix {
    constructor(a = 1, b = 0, c = 0, d = 0, e = 1, f = 0) {
        this.a = a; this.b = b; this.c = c;
        this.d = d; this.e = e; this.f = f;
    }
    clone() {
        return new AffineTransformationMatrix(this.a, this.b, this.c, this.d, this.e, this.f);
    }
    multiply(o) {
        const a = this.a * o.a + this.b * o.d;
        const b = this.a * o.b + this.b * o.e;
        const c = this.a * o.c + this.b * o.f + this.c;
        const d = this.d * o.a + this.e * o.d;
        const e = this.d * o.b + this.e * o.e;
        const f = this.d * o.c + this.e * o.f + this.f;
        this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
        return this;
    }
    apply(v) {
        return new Vector2D(this.a * v.x + this.b * v.y + this.c,
                            this.d * v.x + this.e * v.y + this.f);
    }
    translate(v) { return this.multiply(new AffineTransformationMatrix(1, 0, v.x, 0, 1, v.y)); }
    scale(v) { return this.multiply(new AffineTransformationMatrix(v.x, 0, 0, 0, v.y, 0)); }
    rotate(degrees, point) {
        if (point) {
            // Faithful to the original (which translates by +point twice).
            this.translate(point);
            this.rotate(degrees);
            this.translate(point);
            return this;
        }
        const r = degrees * Math.PI / 180;
        return this.multiply(new AffineTransformationMatrix(
            Math.cos(r), -Math.sin(r), 0, Math.sin(r), Math.cos(r), 0));
    }
    skewX(degrees) {
        return this.multiply(new AffineTransformationMatrix(
            1, Math.tan(degrees * Math.PI / 180), 0, 0, 1, 0));
    }
    skewY(degrees) {
        return this.multiply(new AffineTransformationMatrix(
            1, 0, 0, Math.tan(degrees * Math.PI / 180), 1, 0));
    }
}

class BoundingBox {
    constructor(topLeft, bottomRight) {
        this.topLeft = topLeft || new Vector2D();
        this.bottomRight = bottomRight || new Vector2D();
    }
    static fromPoints(points) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        return new BoundingBox(new Vector2D(minX, minY), new Vector2D(maxX, maxY));
    }
    static union(b1, b2) {
        return new BoundingBox(
            new Vector2D(Math.min(b1.topLeft.x, b2.topLeft.x), Math.min(b1.topLeft.y, b2.topLeft.y)),
            new Vector2D(Math.max(b1.bottomRight.x, b2.bottomRight.x),
                         Math.max(b1.bottomRight.y, b2.bottomRight.y)));
    }
    getTopLeft() { return this.topLeft; }
    getBottomRight() { return this.bottomRight; }
    hasPoint(p) {
        return !(p.x < this.topLeft.x || p.x > this.bottomRight.x ||
                 p.y < this.topLeft.y || p.y > this.bottomRight.y);
    }
    intersectsWith(other) {
        return !(this.topLeft.x > other.bottomRight.x ||
                 this.bottomRight.x < other.topLeft.x ||
                 this.topLeft.y > other.bottomRight.y ||
                 this.bottomRight.y < other.topLeft.y);
    }
    /** Swept test. Ported as-is, including its quirks. */
    intersectsWithMoving(other, vel1, vel2) {
        if (this.intersectsWith(other)) return true;
        const velocity = vel2.sub(vel1);
        let t0, t1, tMinX, tMaxX, tMinY, tMaxY;
        if (velocity.x === 0) {
            t0 = (this.bottomRight.x - other.topLeft.x) / velocity.x;
            t1 = (this.topLeft.x - other.bottomRight.x) / velocity.x;
            tMinX = Math.min(t0, t1);
            tMaxX = Math.max(t0, t1);
        } else {
            if (this.topLeft.x < other.bottomRight.x && this.bottomRight.x > other.topLeft.x) {
                tMinX = 0; tMaxX = 1;
            } else {
                return false;
            }
        }
        if (tMaxX < 0 || tMinX > 1) return false;
        if (velocity.y === 0) {
            t0 = (this.bottomRight.y - other.topLeft.y) / velocity.y;
            t1 = (this.topLeft.y - other.bottomRight.y) / velocity.y;
            tMinY = Math.min(t0, t1);
            tMaxY = Math.max(t0, t1);
        } else {
            if (this.topLeft.y < other.bottomRight.y && this.bottomRight.y > other.topLeft.y) {
                tMinY = 0; tMaxY = 1;
            } else {
                return false;
            }
        }
        if (tMaxY < 0 || tMinY > 1) return false;
        if (tMaxX < tMinY || tMinX > tMaxY) return false;
        const exact = Math.min(tMinX, tMinY);
        return exact >= 0 && exact <= 1;
    }
    completelyIn(other) {
        return this.topLeft.x >= other.topLeft.x && this.bottomRight.x <= other.bottomRight.x &&
               this.topLeft.y >= other.topLeft.y && this.bottomRight.y <= other.bottomRight.y;
    }
}

class Line {
    constructor(point, vector) {
        this.point = point;
        this.vector = vector.normalized();
        this.signedDistanceConstant = -this.getNormal().dot(point);
    }
    getNormal() { return new Vector2D(-this.vector.y, this.vector.x); }
    getClosestPoint(p) {
        const t = this.vector.dot(p.sub(this.point));
        return this.point.add(this.vector.mul(t));
    }
    getDistance(p) { return p.getDistance(this.getClosestPoint(p)); }
    getSignedDistance(p) { return this.getNormal().dot(p) + this.signedDistanceConstant; }
}

/* Path segments: LineSegment, QuadraticCurve, CubicCurve, EllipticalArc. */

class LineSegment {
    constructor(start, end) {
        this.start = start;
        this.end = end;
        this.boundingBox = null;
    }
    getStart() { return this.start; }
    getEnd() { return this.end; }
    getLine() { return new Line(this.start, this.end.sub(this.start)); }
    getLength() { return this.start.getDistance(this.end); }
    getPoint(t) {
        return new Vector2D(this.start.x * (1 - t) + this.end.x * t,
                            this.start.y * (1 - t) + this.end.y * t);
    }
    getBoundingBox() {
        if (!this.boundingBox) {
            this.boundingBox = new BoundingBox(
                new Vector2D(Math.min(this.start.x, this.end.x), Math.min(this.start.y, this.end.y)),
                new Vector2D(Math.max(this.start.x, this.end.x), Math.max(this.start.y, this.end.y)));
        }
        return this.boundingBox;
    }
}

class Curve {
    calculateLength() {
        const simpleGuess = this.getLengthGuess();
        const increment = 1 / simpleGuess;
        this.length = 0;
        let previous = this.getPoint(0);
        for (let t = increment; t <= 1; t += increment) {
            const current = this.getPoint(t);
            this.length += previous.getDistance(current);
            previous = current;
        }
    }
    getLength() { return this.length; }
}

class QuadraticCurve extends Curve {
    constructor(start, control, end) {
        super();
        this.start = start; this.control = control; this.end = end;
        this.calculateLength();
    }
    getPoint(t) {
        const u = 1 - t, s = this.start, c = this.control, e = this.end;
        return new Vector2D(u * u * s.x + 2 * u * t * c.x + t * t * e.x,
                            u * u * s.y + 2 * u * t * c.y + t * t * e.y);
    }
    getLengthGuess() {
        return this.start.getDistance(this.control) + this.control.getDistance(this.end);
    }
}

class CubicCurve extends Curve {
    constructor(start, control1, control2, end) {
        super();
        this.start = start; this.control1 = control1; this.control2 = control2; this.end = end;
        this.calculateLength();
    }
    getPoint(t) {
        const u = 1 - t, s = this.start, c1 = this.control1, c2 = this.control2, e = this.end;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        return new Vector2D(a * s.x + b * c1.x + c * c2.x + d * e.x,
                            a * s.y + b * c1.y + c * c2.y + d * e.y);
    }
    getLengthGuess() {
        return this.start.getDistance(this.control1) +
               this.control1.getDistance(this.control2) + this.control2.getDistance(this.end);
    }
}

class EllipticalArc extends Curve {
    constructor(start, radius, phi, largeArc, sweep, end) {
        super();
        this.radius = radius;
        this.phi = phi;
        const rotate = new AffineTransformationMatrix().rotate(phi);
        const rotateMinus = new AffineTransformationMatrix().rotate(-phi);
        const tmp1 = rotateMinus.apply(start.sub(end).div(2));
        const rx = radius.x, ry = radius.y;
        let s = Math.sqrt((rx * rx * ry * ry - rx * rx * tmp1.y * tmp1.y - ry * ry * tmp1.x * tmp1.x) /
                          (rx * rx * tmp1.y * tmp1.y + ry * ry * tmp1.x * tmp1.x));
        if (largeArc === sweep) s = -s;
        const tmpCenter = new Vector2D(rx * tmp1.y / ry, -ry * tmp1.x / rx).mul(s);
        this.center = rotate.apply(tmpCenter).add(start.add(end).div(2));
        const v1 = new Vector2D((tmp1.x - tmpCenter.x) / rx, (tmp1.y - tmpCenter.y) / ry);
        const v2 = new Vector2D((-tmp1.x - tmpCenter.x) / rx, (-tmp1.y - tmpCenter.y) / ry);
        this.theta1 = new Vector2D(1, 0).getAngle(v1);
        this.deltaTheta = v1.getAngle(v2);
        if (!sweep && this.deltaTheta > 0) this.deltaTheta -= 360;
        else if (sweep && this.deltaTheta < 0) this.deltaTheta += 360;
        if (this.theta1 > this.deltaTheta) this.theta1 -= 360;
        this.rotation = rotate;
        this.calculateLength();
    }
    getPoint(t) {
        const theta = (this.theta1 + t * this.deltaTheta) * Math.PI / 180;
        return this.rotation.apply(new Vector2D(this.radius.x * Math.cos(theta),
                                                this.radius.y * Math.sin(theta))).add(this.center);
    }
    getLengthGuess() { return Math.max(this.radius.x, this.radius.y) * Math.PI * 2; }
}

/* Quad tree over objects exposing getBoundingBox() (which may return null). */

class QuadTreeNode {
    constructor(tree, boundingBox, depth) {
        this.tree = tree;
        this.boundingBox = boundingBox;
        this.children = null;
        this.objects = [];
        this.depth = depth;
    }
    addObject(object) {
        if (this.children) {
            const bb = object.getBoundingBox();
            for (let i = 0; i < 4; i++) {
                if (bb.completelyIn(this.children[i].boundingBox)) {
                    this.children[i].addObject(object);
                    return;
                }
            }
            this.objects.push(object);
        } else {
            this.objects.push(object);
            // Depth guard (not in the original) avoids endless subdivision of
            // many coincident objects.
            if (this.objects.length >= this.tree.subdivideLimit && this.depth < 24)
                this.subdivide();
        }
    }
    subdivide() {
        const tl = this.boundingBox.topLeft, br = this.boundingBox.bottomRight;
        const size = br.sub(tl).mul(0.5);
        const d = this.depth + 1;
        this.children = [
            new QuadTreeNode(this.tree, new BoundingBox(tl, tl.add(size)), d),
            new QuadTreeNode(this.tree, new BoundingBox(tl.add(size.onlyY()), tl.add(size.onlyY()).add(size)), d),
            new QuadTreeNode(this.tree, new BoundingBox(tl.add(size), br), d),
            new QuadTreeNode(this.tree, new BoundingBox(tl.add(size.onlyX()), tl.add(size.onlyX()).add(size)), d),
        ];
        const original = this.objects;
        this.objects = [];
        for (const o of original) this.addObject(o);
    }
    findObjects(boundingBox, result) {
        for (const o of this.objects)
            if (o.getBoundingBox().intersectsWith(boundingBox)) result.push(o);
        if (this.children) {
            for (const c of this.children)
                if (boundingBox.intersectsWith(c.boundingBox)) c.findObjects(boundingBox, result);
        }
    }
}

class QuadTree {
    constructor(objects, subdivideLimit = 20) {
        this.subdivideLimit = subdivideLimit;
        this.root = null;
        const bounded = objects.filter(o => o.getBoundingBox());
        if (bounded.length) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const o of bounded) {
                const bb = o.getBoundingBox();
                if (bb.topLeft.x < minX) minX = bb.topLeft.x;
                if (bb.bottomRight.x > maxX) maxX = bb.bottomRight.x;
                if (bb.topLeft.y < minY) minY = bb.topLeft.y;
                if (bb.bottomRight.y > maxY) maxY = bb.bottomRight.y;
            }
            this.root = new QuadTreeNode(this,
                new BoundingBox(new Vector2D(minX, minY), new Vector2D(maxX, maxY)), 0);
            for (const o of bounded) this.root.addObject(o);
        }
    }
    findObjects(boundingBox, result) {
        if (this.root) this.root.findObjects(boundingBox, result);
        return result;
    }
}

/**
 * Ellipsoid-vs-line-segment swept collision detection against all paths of a
 * sketch (the world). Port of CollisionDetector.cpp.
 */
class CollisionDetector {
    constructor(sketch) {
        this.objects = [];
        this.addLinesFromGroup(sketch.getRoot());
        this.tree = new QuadTree(this.objects);
    }
    addLinesFromGroup(group) {
        for (const element of group.elements) {
            if (element instanceof Group) this.addLinesFromGroup(element);
            else if (element instanceof Path) this.addLinesFromPath(element);
        }
    }
    addLinesFromPath(path) {
        for (const component of path.components) {
            for (const segment of component.segments) {
                const increment = Path.SUBDIVIDE_LENGTH / segment.getLength();
                let previous = segment.getPoint(0);
                for (let t = increment; t <= 1; t += increment) {
                    const current = segment.getPoint(t);
                    this.objects.push(new LineSegment(current, previous));
                    previous = current;
                }
                this.objects.push(new LineSegment(previous, segment.getPoint(1)));
            }
        }
    }
    /** Returns {time, collision} or null. */
    getClosestCollision(radius, position, velocity) {
        let best = null;
        const ePosition = new Vector2D(position.x / radius.x, position.y / radius.y);
        const eVelocity = new Vector2D(velocity.x / radius.x, velocity.y / radius.y);
        const destination = position.add(velocity);
        const boundingBox = BoundingBox.union(
            new BoundingBox(position.sub(radius), position.add(radius)),
            new BoundingBox(destination.sub(radius), destination.add(radius)));
        const result = this.tree.findObjects(boundingBox, []);
        for (const segment of result) {
            const eSegment = new LineSegment(
                new Vector2D(segment.start.x / radius.x, segment.start.y / radius.y),
                new Vector2D(segment.end.x / radius.x, segment.end.y / radius.y));
            const c = this.segmentCollision(eSegment, ePosition, eVelocity);
            if (c && (!best || c.time < best.time)) {
                best = {
                    time: c.time,
                    collision: new Vector2D(c.collision.x * radius.x, c.collision.y * radius.y),
                };
            }
        }
        return best;
    }
    segmentCollision(segment, position, velocity) {
        const line = segment.getLine();
        const signedDistanceToLine = line.getSignedDistance(position);
        const normalDotVelocity = line.getNormal().dot(velocity);
        let t0, t1;
        if (normalDotVelocity === 0) {
            if (line.getDistance(position) < 1) { t0 = 0; t1 = 1; }
            else return null;
        } else {
            t0 = (1 - signedDistanceToLine) / normalDotVelocity;
            t1 = (-1 - signedDistanceToLine) / normalDotVelocity;
            if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
            if (t0 > 1 || t1 < 0) return null;
            t0 = MathManager.clamp(t0, 0, 1);
            t1 = MathManager.clamp(t1, 0, 1);
        }
        let found = false;
        let time = 1;
        let collision = null;
        let root = this.pointCollision(position, velocity, segment.start, time);
        if (root !== null) { found = true; time = root; collision = segment.start; }
        root = this.pointCollision(position, velocity, segment.end, time);
        if (root !== null) { found = true; time = root; collision = segment.end; }
        const segmentBox = segment.getBoundingBox();
        let collisionPoint = line.getClosestPoint(position.add(velocity.mul(t0)));
        if (segmentBox.hasPoint(collisionPoint) && t0 <= time && t0 >= 0) {
            time = t0; found = true; collision = collisionPoint;
        } else {
            collisionPoint = line.getClosestPoint(position.add(velocity.mul(t1)));
            if (segmentBox.hasPoint(collisionPoint) && t1 <= time && t1 >= 0) {
                time = t1; found = true; collision = collisionPoint;
            }
        }
        return found ? { time, collision } : null;
    }
    pointCollision(position, velocity, point, treshold) {
        return MathManager.getLowestPositiveRoot(
            velocity.getSquaredLength(),
            2 * velocity.dot(position.sub(point)),
            point.sub(position).getSquaredLength() - 1,
            treshold);
    }
}
