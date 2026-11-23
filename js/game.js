// jvgs::game - port of src/game/*.cpp and core/PropertyMap, core/XMLLoadable.
"use strict";

/* ---------------------------------------------------------------------- */
/* XML helpers (TinyXML equivalents)                                       */
/* ---------------------------------------------------------------------- */

function firstChildElement(element, name) {
    for (const child of element.children) if (child.tagName === name) return child;
    return null;
}

function childElements(element, name) {
    const out = [];
    for (const child of element.children) if (child.tagName === name) out.push(child);
    return out;
}

/** QueryFloatAttribute: returns the attribute as a float, or `def`. */
function queryFloat(element, name, def) {
    const v = element.getAttribute(name);
    if (v === null) return def;
    const f = parseFloat(v);
    return isNaN(f) ? def : f;
}

function queryBool(element, name, def) {
    const v = element.getAttribute(name);
    if (v === null) return def;
    if (v === "true") return true;
    if (v === "false") return false;
    console.error("Bool attributes should be true or false.");
    return def;
}

/**
 * XMLLoadable::load: an element with a filename="..." attribute first loads
 * that file's root element, then its own data on top of it.
 */
function xmlLoad(object, elementOrFileName) {
    const element = typeof elementOrFileName === "string"
        ? Resources.xml(elementOrFileName) : elementOrFileName;
    const fileName = element.getAttribute("filename");
    if (fileName) xmlLoad(object, fileName);
    object.loadData(element);
}

/* ---------------------------------------------------------------------- */
/* Sprites                                                                  */
/* ---------------------------------------------------------------------- */

class Animation {
    constructor(element) {
        this.id = "";
        this.frames = [];
        this.currentFrame = 0;
        this.counter = 0;
        if (element) xmlLoad(this, element);
    }
    loadData(element) {
        const id = element.getAttribute("id");
        if (id) this.id = id;
        else console.error("Animations must have an id.");
        for (const frame of childElements(element, "frame"))
            this.addFrame(frame.getAttribute("sketch"), queryFloat(frame, "duration", 0));
    }
    addFrame(fileName, duration) {
        this.frames.push({ sketch: SketchManager.getSketch(fileName), duration });
    }
    update(ms) {
        if (!this.frames.length) return;
        this.counter += ms;
        let guard = 0;
        while (this.counter >= this.frames[this.currentFrame].duration && guard++ < 1000) {
            this.counter -= this.frames[this.currentFrame].duration;
            this.currentFrame = (this.currentFrame + 1) % this.frames.length;
        }
    }
    render(video) {
        if (this.frames.length) this.frames[this.currentFrame].sketch.render(video);
    }
}

class Sprite {
    /** Accepts an XML element, a file name, or nothing. */
    constructor(source) {
        this.animations = new Map();
        if (source) xmlLoad(this, source);
        this.current = "standing";
    }
    loadData(element) {
        for (const child of childElements(element, "animation")) {
            const animation = new Animation(child);
            this.animations.set(animation.id, animation);
        }
    }
    setAnimation(name) {
        if (this.animations.has(name)) this.current = name;
    }
    update(ms) {
        const a = this.animations.get(this.current);
        if (a) a.update(ms);
    }
    render(video) {
        const a = this.animations.get(this.current);
        if (a) a.render(video);
    }
}

/* ---------------------------------------------------------------------- */
/* Controllers                                                             */
/* ---------------------------------------------------------------------- */

class Controller {
    constructor(entity) { this.entity = entity; }
    loadData() {}
    affect() {}
}

class BullController extends Controller {
    constructor(entity, element) {
        super(entity);
        this.target = "";
        this.sight = 0;
        if (element) xmlLoad(this, element);
    }
    loadData(element) {
        const target = element.getAttribute("target");
        if (target) this.target = target;
        else console.error("BullController must have a target.");
        this.sight = queryFloat(element, "sight", this.sight);
    }
    affect() {
        const entity = this.entity;
        const level = entity.getLevel();
        const velocity = entity.getVelocity().clone();
        if (level) {
            const target = level.getEntityById(this.target);
            if (target) {
                const distance = entity.getPosition().getDistance(target.getPosition());
                if (distance <= this.sight) {
                    const toTarget = target.getPosition().sub(entity.getPosition());
                    toTarget.setLength(entity.getSpeed());
                    velocity.x = toTarget.x;
                }
            }
        }
        entity.setVelocity(velocity);
    }
}

class InputController extends Controller {
    constructor(entity, element) {
        super(entity);
        if (element) xmlLoad(this, element);
    }
    loadData() {}
    affect() {
        const entity = this.entity;
        const cfg = InputConfiguration, input = InputManager;
        const velocity = new Vector2D();
        if (input.isKeyDown(cfg.getKey("left"))) velocity.x = -entity.getSpeed();
        else if (input.isKeyDown(cfg.getKey("right"))) velocity.x = entity.getSpeed();
        if (input.isKeyDown(cfg.getKey("up"))) velocity.y = -entity.getSpeed();
        else if (input.isKeyDown(cfg.getKey("down"))) velocity.y = entity.getSpeed();
        if (input.isKeyTicked(cfg.getKey("action"))) EntityEventManager.action(entity);
        entity.setVelocity(velocity);
    }
}

class DefaultInputController extends Controller {
    constructor(entity, element) {
        super(entity);
        this.minJumpDelay = 200;
        this.jumpForce = 50;
        this.jumpDelay = 0;
        if (element) xmlLoad(this, element);
    }
    loadData(element) {
        this.minJumpDelay = queryFloat(element, "minjumpdelay", this.minJumpDelay);
        this.jumpForce = queryFloat(element, "jumpforce", this.jumpForce);
    }
    affect(ms) {
        const entity = this.entity;
        const cfg = InputConfiguration, input = InputManager;
        let velocity = entity.getVelocity().clone();
        const positioner = entity.getPositioner();
        if (this.jumpDelay > 0) this.jumpDelay -= ms;
        if (positioner) {
            if (input.isKeyDown(cfg.getKey("jump")) && positioner.canJump() && this.jumpDelay <= 0) {
                this.jumpDelay = this.minJumpDelay;
                velocity = positioner.getGravity().mul(-1 * this.jumpForce);
            }
        }
        if (input.isKeyDown(cfg.getKey("left"))) velocity.x = -entity.getSpeed();
        else if (input.isKeyDown(cfg.getKey("right"))) velocity.x = entity.getSpeed();
        else velocity.x = 0;
        if (input.isKeyTicked(cfg.getKey("action"))) EntityEventManager.action(entity);
        entity.setVelocity(velocity);
    }
}

class FlyStraightController extends Controller {
    constructor(entity, element) {
        super(entity);
        if (element) xmlLoad(this, element);
    }
}

class PatrollingController extends Controller {
    constructor(entity, element) {
        super(entity);
        this.x1 = 0;
        this.x2 = 0;
        this.toX1 = false; // Uninitialised in the original.
        if (element) xmlLoad(this, element);
    }
    loadData(element) {
        const a = queryFloat(element, "x1", 0), b = queryFloat(element, "x2", 0);
        this.x1 = Math.min(a, b);
        this.x2 = Math.max(a, b);
    }
    affect() {
        const entity = this.entity;
        const position = entity.getPosition();
        const velocity = entity.getVelocity().clone();
        if (position.x < this.x1 && this.toX1) this.toX1 = false;
        else if (position.x > this.x2 && !this.toX1) this.toX1 = true;
        else velocity.x = this.toX1 ? -entity.getSpeed() : entity.getSpeed();
        entity.setVelocity(velocity);
    }
}

class SillyController extends Controller {
    constructor(entity, element) {
        super(entity);
        this.speedTreshold = 0;
        if (element) xmlLoad(this, element);
        this.walkingRight = true;
    }
    loadData(element) {
        this.speedTreshold = queryFloat(element, "speedtreshold", this.speedTreshold);
    }
    affect() {
        const entity = this.entity;
        if (entity.getVelocity().getLength() < this.speedTreshold * entity.getSpeed())
            this.walkingRight = !this.walkingRight;
        const velocity = entity.getVelocity().clone();
        velocity.x = this.walkingRight ? entity.getSpeed() : -entity.getSpeed();
        entity.setVelocity(velocity);
    }
}

class SimpleBirdController extends Controller {
    constructor(entity, element) {
        super(entity);
        this.points = [];
        this.currentPoint = -1;
        if (element) xmlLoad(this, element);
    }
    loadData(element) {
        for (const p of childElements(element, "point")) {
            const point = new Vector2D();
            Vector2D.fromXML(p, point);
            this.addPoint(point);
        }
    }
    addPoint(point) {
        if (this.currentPoint < 0) this.currentPoint = 0;
        this.points.push(point);
    }
    affect(ms) {
        if (this.currentPoint < 0) return;
        const entity = this.entity;
        const position = entity.getPosition();
        const target = this.points[this.currentPoint];
        const velocity = target.sub(position);
        velocity.setLength(entity.getSpeed());
        const destination = position.add(velocity.mul(ms));
        if (destination.getDistance(target) > position.getDistance(target) ||
                position.getDistance(target) < 0.00001)
            this.currentPoint = (this.currentPoint + 1) % this.points.length;
        entity.setVelocity(velocity);
    }
}

/* ---------------------------------------------------------------------- */
/* Positioners                                                             */
/* ---------------------------------------------------------------------- */

class Positioner {
    constructor(entity) {
        this.entity = entity;
        this.gravity = new Vector2D();
    }
    loadData(element) {
        Vector2D.fromXML(firstChildElement(element, "gravity"), this.gravity);
    }
    getGravity() { return this.gravity; }
    setGravity(g) { this.gravity = g.clone(); }
    canJump() { return true; }
    affect() {}
}

class NaivePositioner extends Positioner {
    constructor(entity, element) {
        super(entity);
        if (element) xmlLoad(this, element);
    }
    affect(ms) {
        const entity = this.entity;
        entity.setFalling(true);
        const velocity = entity.getVelocity();
        entity.setPosition(entity.getPosition().add(velocity.mul(ms)));
        entity.setVelocity(velocity.add(this.gravity.mul(ms)));
    }
}

class CollisionDestroyPositioner extends Positioner {
    constructor(entity, element) {
        super(entity);
        if (element) xmlLoad(this, element);
    }
    affect(ms) {
        const entity = this.entity;
        const cd = entity.getLevel().getCollisionDetector();
        const position = entity.getPosition();
        const velocity = entity.getVelocity().mul(ms);
        const c = cd.getClosestCollision(entity.getRadius(), position, velocity);
        if (c) {
            entity.setGarbage();
            entity.setPosition(c.collision);
        } else {
            entity.setPosition(position.add(velocity));
        }
        entity.setVelocity(entity.getVelocity().add(this.gravity.mul(ms)));
    }
}

class CollisionResponsePositioner extends Positioner {
    constructor(entity, element) {
        super(entity);
        this.jumpDistanceLimit = 100;
        if (element) xmlLoad(this, element);
    }
    loadData(element) {
        super.loadData(element);
        this.jumpDistanceLimit = queryFloat(element, "jumpdistancelimit", this.jumpDistanceLimit);
    }
    affect(ms) {
        const VERY_CLOSE = CollisionResponsePositioner.VERY_CLOSE;
        const entity = this.entity;
        const cd = entity.getLevel().getCollisionDetector();
        const radius = entity.getRadius();
        let timeLeft = 1;
        let position = entity.getPosition();
        let velocity = entity.getVelocity().mul(ms);
        let collisionSteps = 0;
        while (collisionSteps < CollisionResponsePositioner.MAX_STEPS && timeLeft > 0 &&
                velocity.getLength() > VERY_CLOSE) {
            const destination = position.add(velocity);
            const c = cd.getClosestCollision(radius, position, velocity);
            if (c) {
                const time = c.time;
                let newPosition = position;
                if (time <= 0) {
                    // Stuck.
                    const correction = this.gravity.neg();
                    correction.setLength(VERY_CLOSE);
                    newPosition = position.add(correction);
                } else {
                    const distance = velocity.mul(time).getLength();
                    if (distance >= VERY_CLOSE) {
                        const v = velocity.clone();
                        v.setLength(distance - VERY_CLOSE);
                        newPosition = position.add(v);
                    }
                }
                velocity = velocity.mul(1 - time);
                const normalForce = position.sub(c.collision);
                normalForce.setLength(velocity.getLength());
                velocity = velocity.add(normalForce).div(2);
                position = newPosition;
                timeLeft -= time;
            } else {
                position = destination;
                timeLeft = 0;
            }
            collisionSteps++;
        }
        if (collisionSteps >= CollisionResponsePositioner.MAX_STEPS) velocity = new Vector2D();
        velocity = velocity.mul(1 / ms);

        entity.setFalling(false);
        entity.setSlipping(false);
        const down = this.gravity.clone();
        down.setLength(VERY_CLOSE * 20);
        const c = cd.getClosestCollision(radius, position, down);
        if (c) {
            const fall = c.collision.sub(position);
            const cosine = this.gravity.dot(fall) / (this.gravity.getLength() * fall.getLength());
            if (cosine < 1 - CollisionResponsePositioner.SLIP_LIMIT ||
                    cosine > 1 + CollisionResponsePositioner.SLIP_LIMIT)
                entity.setSlipping(true);
        } else {
            entity.setFalling(true);
        }
        if (entity.isFalling() || entity.isSlipping()) velocity = velocity.add(this.gravity.mul(ms));
        entity.setPosition(position);
        entity.setVelocity(velocity);
    }
    canJump() {
        const entity = this.entity;
        const down = this.gravity.clone();
        down.setLength(this.jumpDistanceLimit);
        return !!entity.getLevel().getCollisionDetector()
            .getClosestCollision(entity.getRadius(), entity.getPosition(), down);
    }
}
CollisionResponsePositioner.VERY_CLOSE = 0.1;
CollisionResponsePositioner.MAX_STEPS = 10;
CollisionResponsePositioner.SLIP_LIMIT = 0.1;

const controllerFactories = {
    bullcontroller: BullController,
    defaultinputcontroller: DefaultInputController,
    flystraightcontroller: FlyStraightController,
    inputcontroller: InputController,
    patrollingcontroller: PatrollingController,
    sillycontroller: SillyController,
    simplebirdcontroller: SimpleBirdController,
};

const positionerFactories = {
    collisiondestroypositioner: CollisionDestroyPositioner,
    collisionresponsepositioner: CollisionResponsePositioner,
    naivepositioner: NaivePositioner,
};

/* ---------------------------------------------------------------------- */
/* Entity                                                                   */
/* ---------------------------------------------------------------------- */

class Entity {
    /**
     * new Entity(level)                  - empty entity
     * new Entity(level, element)         - from an XML element
     * new Entity(level, "file.xml")      - from a file
     */
    constructor(level, source) {
        this.id = "none";
        this.level = level;
        this.position = new Vector2D();
        this.velocity = new Vector2D();
        this.speed = 0.3;
        this.radius = new Vector2D();
        this.collisionChecker = false;
        this.falling = true;
        this.slipping = false;
        this.controller = null;
        this.positioner = null;
        this.sprite = null;
        this.script = "";
        this.entries = new Map();
        this.garbage = false;
        if (source) xmlLoad(this, source);
        this.facingRight = true;
        this.timer = 0;
    }
    loadData(element) {
        for (const entry of childElements(element, "entry")) {
            const key = entry.getAttribute("key");
            if (key === null) { console.error("A key should always be defined in a map!"); continue; }
            const value = entry.getAttribute("value");
            this.entries.set(key, value !== null ? value : "1");
        }
        const id = element.getAttribute("id");
        if (id) this.id = id;
        Vector2D.fromXML(firstChildElement(element, "position"), this.position);
        Vector2D.fromXML(firstChildElement(element, "velocity"), this.velocity);
        Vector2D.fromXML(firstChildElement(element, "radius"), this.radius);
        this.collisionChecker = queryBool(element, "collisionchecker", this.collisionChecker);
        this.speed = queryFloat(element, "speed", this.speed);

        const controllerElement = firstChildElement(element, "controller");
        if (controllerElement) {
            const type = controllerElement.getAttribute("type");
            const Factory = controllerFactories[type];
            if (Factory) this.controller = new Factory(this, controllerElement);
            else console.error("No controller: " + type);
        }
        const positionerElement = firstChildElement(element, "positioner");
        if (positionerElement) {
            const type = positionerElement.getAttribute("type");
            const Factory = positionerFactories[type];
            if (Factory) this.positioner = new Factory(this, positionerElement);
            else console.error("No positioner: " + type);
        }
        const spriteElement = firstChildElement(element, "sprite");
        if (spriteElement) this.sprite = new Sprite(spriteElement);
        const script = element.getAttribute("script");
        if (script) this.script = script;
    }

    getId() { return this.id; }
    setId(id) { this.id = id; }
    getLevel() { return this.level; }
    getPosition() { return this.position; }
    setPosition(p) { this.position = p.clone(); }
    getVelocity() { return this.velocity; }
    setVelocity(v) { this.velocity = v.clone(); }
    getSpeed() { return this.speed; }
    setSpeed(s) { this.speed = s; }
    getRadius() { return this.radius; }
    setRadius(r) { this.radius = r.clone(); }
    isCollisionChecker() { return this.collisionChecker; }
    setCollisionChecker(c) { this.collisionChecker = c; }
    isFalling() { return this.falling; }
    setFalling(f) { this.falling = f; }
    isSlipping() { return this.slipping; }
    setSlipping(s) { this.slipping = s; }
    getController() { return this.controller; }
    setController(c) { this.controller = c; }
    getPositioner() { return this.positioner; }
    setPositioner(p) { this.positioner = p; }
    getSprite() { return this.sprite; }
    setSprite(s) { this.sprite = s; }
    getScript() { return this.script; }
    setScript(s) { this.script = s; }
    getTimer() { return this.timer; }
    setTimer(t) { this.timer = t; }
    isFacingRight() { return this.facingRight; }
    isGarbage() { return this.garbage; }

    // PropertyMap
    isSet(key) { return this.entries.has(key); }
    get(key) { return this.entries.has(key) ? this.entries.get(key) : ""; }
    getBool(key) { return this.entries.get(key) === "true"; }
    set(key, value) {
        this.entries.set(key, String(value));
        EntityEventManager.property(this, key);
    }
    setBool(key, value) {
        this.entries.set(key, value ? "true" : "false");
        EntityEventManager.property(this, key);
    }

    setGarbage() {
        this.garbage = true;
        EntityEventManager.die(this);
    }

    getBoundingBox() {
        return new BoundingBox(this.position.sub(this.radius), this.position.add(this.radius));
    }

    update(ms) {
        if (this.controller) this.controller.affect(ms);
        if (this.positioner) this.positioner.affect(ms);
        if (this.timer > 0) {
            if (this.timer - ms <= 0) EntityEventManager.timer(this);
            this.timer -= ms;
        }
        const vx = this.velocity.x;
        if (vx <= -0.1 * this.speed && this.facingRight) this.facingRight = false;
        if (vx >= 0.1 * this.speed && !this.facingRight) this.facingRight = true;
        if (this.sprite) {
            if (this.falling || this.slipping) this.sprite.setAnimation("falling");
            else if (this.velocity.getLength() >= 0.2 * this.speed) this.sprite.setAnimation("walking");
            else this.sprite.setAnimation("standing");
            this.sprite.update(ms);
        }
        if (this.collisionChecker) {
            const mine = this.getBoundingBox();
            const level = this.level;
            for (let i = 0; i < level.getNumberOfEntities(); i++) {
                const other = level.getEntity(i);
                if (other !== this && mine.intersectsWithMoving(other.getBoundingBox(),
                        this.velocity.mul(ms), other.getVelocity().mul(ms)))
                    EntityEventManager.collision(this, other);
            }
        }
    }

    render(video) {
        if (!this.sprite) return;
        video.push();
        video.translate(this.position);
        if (!this.facingRight) video.scale(new Vector2D(-1, 1));
        video.translate(this.radius.neg());
        this.sprite.render(video);
        video.pop();
    }
}

/* ---------------------------------------------------------------------- */
/* Events                                                                   */
/* ---------------------------------------------------------------------- */

class EntityEvent {
    constructor(source, type, collider = null, key = "") {
        this.source = source; this.type = type; this.collider = collider; this.key = key;
    }
    getSource() { return this.source; }
    getType() { return this.type; }
    getCollider() { return this.collider; }
    getKey() { return this.key; }
}

const EntityEventManager = {
    events: [],
    collision(a, b) {
        this.events.push(new EntityEvent(a, "collision", b));
        this.events.push(new EntityEvent(b, "collision", a));
    },
    action(e) { this.events.push(new EntityEvent(e, "action")); },
    spawn(e) { this.events.push(new EntityEvent(e, "spawn")); },
    die(e) { this.events.push(new EntityEvent(e, "die")); },
    timer(e) { this.events.push(new EntityEvent(e, "timer")); },
    property(e, key) { this.events.push(new EntityEvent(e, "property", null, key)); },
    /** Runs the source entity's script for each event (including new ones). */
    flush() {
        while (this.events.length) {
            const event = this.events.shift();
            ScriptManager.runScript(event.source.getScript(), event);
        }
    },
    clear() { this.events = []; },
};

/* ---------------------------------------------------------------------- */
/* Cameras                                                                  */
/* ---------------------------------------------------------------------- */

class AbstractCamera {
    constructor(level) {
        this.level = level;
        this.position = new Vector2D();
    }
    loadData(element) {
        Vector2D.fromXML(firstChildElement(element, "position"), this.position);
    }
    getLevel() { return this.level; }
    getPosition() { return this.position; }
    setPosition(p) { this.position = p.clone(); }
    transform(video) {
        video.translate(this.position.neg().add(video.getSize().mul(0.5)));
    }
    getBoundingBox(video) {
        const half = video.getSize().mul(0.5);
        return new BoundingBox(this.position.sub(half), this.position.add(half));
    }
    update() {}
}

class FollowCamera extends AbstractCamera {
    constructor(element, level) {
        super(level);
        this.target = "";
        this.maxDistance = 0;
        xmlLoad(this, element);
    }
    loadData(element) {
        super.loadData(element);
        this.maxDistance = queryFloat(element, "maxdistance", this.maxDistance);
        const target = element.getAttribute("target");
        if (target) this.target = target;
        const entity = this.level.getEntityById(this.target);
        if (entity) this.setPosition(entity.getPosition());
    }
    update() {
        const entity = this.level.getEntityById(this.target);
        if (!entity) return;
        const direction = entity.getPosition().sub(this.position);
        if (direction.getLength() > this.maxDistance) {
            direction.setLength(direction.getLength() - this.maxDistance);
            this.setPosition(this.position.add(direction));
        }
    }
}

class SimpleCamera extends AbstractCamera {
    constructor(element, level) {
        super(level);
        this.velocity = new Vector2D();
        xmlLoad(this, element);
    }
    loadData(element) {
        super.loadData(element);
        Vector2D.fromXML(firstChildElement(element, "velocity"), this.velocity);
    }
    update(ms) { this.setPosition(this.position.add(this.velocity.mul(ms))); }
}

const cameraFactories = { followcamera: FollowCamera, simplecamera: SimpleCamera };

/* ---------------------------------------------------------------------- */
/* Level & LevelManager                                                     */
/* ---------------------------------------------------------------------- */

class Level {
    constructor(fileName) {
        this.world = null;
        this.collisionDetector = null;
        this.camera = null;
        this.entities = [];
        this.entitiesById = new Map();
        xmlLoad(this, fileName);
    }
    loadData(element) {
        const music = element.getAttribute("music");
        if (music) AudioManager.playMusic(music);
        const world = element.getAttribute("world");
        if (world) {
            this.world = new Sketch(world);
            this.collisionDetector = new CollisionDetector(this.world);
            this.boundingBox = new BoundingBox(new Vector2D(), this.world.getSize());
        } else {
            console.warn("No world attribute specified in the level xml.");
        }
        for (const e of childElements(element, "entity")) this.addEntity(new Entity(this, e));
        const cameraElement = firstChildElement(element, "camera");
        if (cameraElement) {
            const type = cameraElement.getAttribute("type");
            const Factory = cameraFactories[type];
            if (Factory) this.camera = new Factory(cameraElement, this);
            else console.error("No camera " + type);
        }
    }
    getWorld() { return this.world; }
    getCollisionDetector() { return this.collisionDetector; }
    getNumberOfEntities() { return this.entities.length; }
    getEntity(i) { return this.entities[i]; }
    addEntity(entity) {
        if (this.getEntityById(entity.getId())) console.warn("Duplicate entity id: " + entity.getId());
        this.entities.push(entity);
        this.entitiesById.set(entity.getId(), entity);
        EntityEventManager.spawn(entity);
    }
    getEntityById(id) { return this.entitiesById.get(id) || null; }

    update(ms) {
        if (this.camera) this.camera.update(ms);
        const worldHeight = this.world ? this.world.getSize().y : Infinity;
        for (let i = 0; i < this.entities.length; i++) {
            const entity = this.entities[i];
            entity.update(ms);
            if (entity.getPosition().y - entity.getRadius().y > worldHeight) entity.setGarbage();
        }
        // Flush events before removing garbage, so no event refers to a
        // removed entity.
        EntityEventManager.flush();
        const original = this.entities;
        this.entities = [];
        for (const entity of original) {
            if (!entity.isGarbage()) this.entities.push(entity);
            else this.entitiesById.delete(entity.getId());
        }
    }

    render(video) {
        let cameraBox = null;
        if (this.camera) {
            this.camera.transform(video);
            cameraBox = this.camera.getBoundingBox(video);
        }
        if (this.world) this.world.render(video, cameraBox);
        for (const entity of this.entities) {
            if (!cameraBox || entity.getBoundingBox().intersectsWith(cameraBox)) entity.render(video);
        }
    }
}

const LevelManager = {
    level: null,
    queue: false,
    queueFileName: "",
    fileName: "",
    timeFactor: 1,

    getLevel() { return this.level; },
    queueLevel(fileName) {
        this.queue = true;
        this.queueFileName = fileName;
    },
    getTimeFactor() { return this.timeFactor; },
    setTimeFactor(t) { this.timeFactor = t; },

    /** One iteration of the original main loop, minus rendering. */
    step(ms) {
        InputManager.update(ms);
        if (this.level && ms > 0) this.level.update(this.timeFactor * ms);
        EffectManager.update(this.timeFactor * ms);
    },
    render(video) {
        video.clear();
        video.identity();
        // Rendering the level applies the camera transformation, which the
        // effects want as well.
        if (this.level) this.level.render(video);
        EffectManager.render(video);
    },
    /** Loads a queued level; returns true if it did. */
    processQueue() {
        if (!this.queue) return false;
        this.level = null;
        EffectManager.clear();
        SketchManager.clear();
        EntityEventManager.clear();
        this.queue = false;
        this.fileName = this.queueFileName;
        this.level = new Level(this.queueFileName);
        this.timeFactor = 1;
        return true;
    },
    /** File name of the level that is currently loaded. */
    getFileName() { return this.fileName; },
};

/**
 * The order of play, read from resources/game.xml: the menu, the levels in
 * order, and the credits shown after the last level.
 */
const GameManager = {
    FILE: "resources/game.xml",
    menu: "",
    credits: "",
    levels: [],
    loaded: false,

    load(fileName = this.FILE) {
        const root = Resources.xml(fileName);
        const file = (tag) => {
            const element = firstChildElement(root, tag);
            return element ? element.getAttribute("filename") : null;
        };
        this.menu = file("menu");
        this.credits = file("credits");
        this.levels = childElements(root, "level").map(e => e.getAttribute("filename"));
        if (!this.menu) console.error(fileName + ": no <menu filename=...>");
        if (!this.levels.length) console.error(fileName + ": no <level filename=...>");
        this.loaded = true;
    },
    ensureLoaded() { if (!this.loaded) this.load(); },

    getMenu() { this.ensureLoaded(); return this.menu; },
    getCredits() { this.ensureLoaded(); return this.credits; },
    getLevels() { this.ensureLoaded(); return this.levels; },
    getFirstLevel() { return this.getLevels()[0]; },
    isLevel(fileName) { return this.getLevels().includes(fileName); },
    /** The level after `fileName`, or null after the last one. */
    getNextLevel(fileName) {
        const levels = this.getLevels();
        const i = levels.indexOf(fileName);
        if (i < 0) console.error("Not a level in " + this.FILE + ": " + fileName);
        return i >= 0 && i + 1 < levels.length ? levels[i + 1] : null;
    },
};
