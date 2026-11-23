// The game's Lua scripts (resources/**/*.lua and resources/modules/*.lua),
// ported to JavaScript. Each entity names its script by the original .lua
// path; the ScriptManager looks up the handler table registered under that
// path and calls the handler for the event type with (self, event), which is
// what `events.trigger{...}` did in Lua.
"use strict";

/** Lua's math.random(m, n): integer in [m, n] (arguments truncated). */
function luaRandom(m, n) {
    m = Math.trunc(m);
    n = Math.trunc(n);
    return m + Math.floor(Math.random() * (n - m + 1));
}

/* resources/modules/jlib.lua */
const jlib = {
    randomItem(list) { return list[luaRandom(1, list.length) - 1]; },
    map(list, f) { return list.map(f); },
};

/* resources/modules/common.lua */
const common = {
    isPlayer(entity) { return entity.getId() === "player"; },
    isDead(entity) {
        return entity.isSet("health") ? Number(entity.get("health")) <= 0 : false;
    },
    damage(entity, amount) {
        if (entity.isSet("health")) entity.set("health", Number(entity.get("health")) - amount);
    },
    gameOver() { LevelManager.queueLevel("resources/level-main-menu/main-menu.xml"); },
    nextLevel(fileName) {
        PersistenceManager.set("level", fileName);
        LevelManager.queueLevel(fileName);
    },
    continue() {
        const fileName = PersistenceManager.isSet("level")
            ? PersistenceManager.get("level") : "resources/level-intro/level.xml";
        LevelManager.queueLevel(fileName);
    },
    dispose(entity) { entity.setPosition(new Vector2D(-100000, -100000)); },
};

/* resources/modules/effects.lua */
const effects = {
    stars(position, amount = 1, names = ["moon", "skull", "spiral", "star"]) {
        const sketches = names.map(e => SketchManager.getSketch("resources/effects/" + e + ".svg"));
        const gravity = new Vector2D(0, 0.003);
        const n = luaRandom(amount * 10, amount * 30);
        for (let i = 1; i <= n; i++) {
            const velocity = Vector2D.fromPolar(0.1 + 1.9 * Math.random(), Math.random() * 360);
            EffectManager.addEffect(new Particle(jlib.randomItem(sketches),
                1000 + 3000 * Math.random(), position, velocity, gravity));
        }
    },
    text(position, str) {
        str = str || jlib.randomItem(["Whack!", "Splash!", "Pow!"]);
        EffectManager.addEffect(new TextEffect(str, position, 1000 + 1000 * Math.random(),
            0.1 + 0.1 * Math.random(), 360 * Math.random()));
    },
    staticText(position, str) {
        EffectManager.addEffect(new TextEffect(str, position, 0, 0, 0));
    },
    commonDie(entity) {
        // Drop him.
        entity.setController(null);
        entity.setPositioner(new NaivePositioner(entity));
        entity.setVelocity(new Vector2D(0, 2 * entity.getSpeed()));
        effects.text(entity.getPosition());
        effects.stars(entity.getPosition());
        if (entity.isSet("die-sound")) AudioManager.playSound(entity.get("die-sound"));
    },
    nextLevelAnimation(entity) {
        // Lift him.
        entity.setController(null);
        entity.setPositioner(new NaivePositioner(entity));
        entity.setVelocity(new Vector2D(0, -entity.getSpeed()));
    },
};

const ScriptManager = {
    scripts: {},
    register(fileName, handlers) { this.scripts[fileName] = handlers; },
    runScript(fileName, event) {
        if (!fileName) return;
        const handlers = this.scripts[fileName];
        if (!handlers) {
            console.error("No such script: " + fileName);
            return;
        }
        const f = handlers[event.getType()];
        if (f) f(event.getSource(), event);
    },
};

/** Common pattern: touching it lifts the player and moves to `next`. */
function levelExit(next) {
    return {
        collision(self, event) {
            if (common.isPlayer(event.getCollider())) {
                effects.nextLevelAnimation(event.getCollider());
                self.setTimer(2000);
            }
        },
        timer() { common.nextLevel(next); },
    };
}

/** Common pattern: picking up a weapon. */
function weaponPickup(weapon, hint) {
    return {
        collision(self, event) {
            const collider = event.getCollider();
            if (common.isPlayer(collider)) {
                collider.setSprite(new Sprite(`resources/player/${weapon}-sprite.xml`));
                collider.set("weapon", weapon);
                self.setGarbage();
                effects.staticText(self.getPosition().add(new Vector2D(0, -100)), hint);
            }
        },
    };
}

function tutorial(text, offsetFromSelf, fixedPosition) {
    return {
        collision(self) {
            const pos = fixedPosition || self.getPosition().add(offsetFromSelf);
            effects.staticText(pos, text);
            self.setGarbage();
        },
    };
}

/* --- resources/player/script.lua --------------------------------------- */

const playerWeapons = {
    knife(self) {
        const level = self.getLevel();
        const entity = new Entity(level, "resources/knife/knife.xml");
        const velocity = Vector2D.fromPolar(entity.getSpeed(), Math.random() * 20 - 10);
        if (!self.isFacingRight()) velocity.setX(-velocity.getX());
        entity.setPosition(self.getPosition());
        entity.setVelocity(velocity);
        level.addEntity(entity);
        self.setTimer(2000);
        AudioManager.playSound("resources/knife/throw.ogg");
    },
    clock(self) {
        EffectManager.addEffect(new TimeEffect(0.2, 3000));
        self.setTimer(3000);
    },
    hat(self) {
        self.setVelocity(new Vector2D(0, -1).mul(self.getSpeed() * 2));
        self.setTimer(500);
        const pos = new Vector2D(self.getPosition().getX(),
                                 self.getPosition().getY() + self.getRadius().getY());
        effects.stars(pos, 0.5, ["star"]);
    },
    grenade(self) {
        const level = self.getLevel();
        const entity = new Entity(level, "resources/grenade/grenade.xml");
        const velocity = Vector2D.fromPolar(entity.getSpeed(), -Math.random() * 45);
        if (!self.isFacingRight()) velocity.setX(-velocity.getX());
        entity.setPosition(self.getPosition());
        entity.setVelocity(velocity);
        level.addEntity(entity);
        self.setTimer(4000);
    },
};

ScriptManager.register("resources/player/script.lua", {
    spawn(self) { self.setBool("ready", true); },
    die() { common.gameOver(); },
    action(self) {
        console.log(`<point x="${self.getPosition().getX().toFixed(0)}" y="${self.getPosition().getY().toFixed(0)}" />`);
        if (self.isSet("weapon") && self.getBool("ready")) {
            const weapon = self.get("weapon");
            if (playerWeapons[weapon]) playerWeapons[weapon](self);
            self.setBool("ready", false);
            self.setSprite(new Sprite("resources/player/regular-sprite.xml"));
        }
    },
    timer(self) {
        if (common.isDead(self)) {
            // Falling sequence limit reached.
            common.gameOver();
        } else {
            if (self.isSet("weapon"))
                self.setSprite(new Sprite("resources/player/" + self.get("weapon") + "-sprite.xml"));
            self.setBool("ready", true);
        }
    },
    property(self, event) {
        if (event.getKey() === "health" && common.isDead(self)) {
            effects.commonDie(self);
            EffectManager.addEffect(new InvertEffect());
            LevelManager.setTimeFactor(0.2);
            // Limit falling sequence.
            self.setTimer(1000);
        }
    },
});

/* --- common-scripts ---------------------------------------------------- */

ScriptManager.register("resources/common-scripts/enemy.lua", {
    collision(self, event) {
        const collider = event.getCollider();
        // React only on player collision.
        if (common.isPlayer(collider) && !common.isDead(self) && !common.isDead(collider)) {
            const y = collider.getPosition().getY() + collider.getRadius().getY();
            if (self.getPosition().getY() > y) common.damage(self, 1);
            else common.damage(collider, 1);
        }
    },
    property(self, event) {
        if (event.getKey() === "health" && common.isDead(self)) effects.commonDie(self);
    },
});

ScriptManager.register("resources/common-scripts/invincible-enemy.lua", {
    collision(self, event) {
        const collider = event.getCollider();
        if (!common.isDead(self) && !common.isDead(collider)) common.damage(collider, 1);
    },
    property(self, event) {
        if (event.getKey() === "health" && common.isDead(self)) effects.commonDie(self);
    },
});

/* --- weapons ----------------------------------------------------------- */

ScriptManager.register("resources/knife/obtain-knife.lua",
    weaponPickup("knife", "left ctrl to throw a knife"));
ScriptManager.register("resources/grenade/obtain-grenade.lua",
    weaponPickup("grenade", "left ctrl to throw a grenade"));
ScriptManager.register("resources/hat/obtain-hat.lua",
    weaponPickup("hat", "left ctrl to jump in-air"));
ScriptManager.register("resources/clock/obtain-clock.lua",
    weaponPickup("clock", "left ctrl to save time"));

ScriptManager.register("resources/knife/script.lua", {
    spawn(self) { self.setTimer(500); },
    collision(self, event) {
        const collider = event.getCollider();
        if (!common.isPlayer(collider)) {
            common.damage(collider, 1);
            self.setGarbage();
        }
    },
    timer(self) { self.setGarbage(); },
});

ScriptManager.register("resources/grenade/script.lua", {
    spawn(self) { self.setTimer(1000 + 4000 * Math.random()); },
    collision(self, event) {
        const collider = event.getCollider();
        if (!common.isPlayer(collider)) {
            common.damage(collider, 1);
            self.setGarbage();
        }
    },
    timer(self) {
        AudioManager.playSound("resources/grenade/explosion.ogg");
        effects.stars(self.getPosition(), 3, ["skull"]);
        effects.text(self.getPosition(), "Boom!");
        const level = self.getLevel();
        for (let i = 0; i < level.getNumberOfEntities(); i++) {
            const entity = level.getEntity(i);
            if (entity.getPosition().getDistance(self.getPosition()) < 150) common.damage(entity, 1);
        }
        self.setGarbage();
    },
});

/* --- spikey ball ------------------------------------------------------- */

ScriptManager.register("resources/spikey-ball/ball-script.lua", {
    collision(self, event) {
        // Only after being dropped.
        if (self.isCollisionChecker()) {
            common.damage(event.getCollider(), 100);
            effects.stars(self.getPosition(), 5);
            self.setGarbage();
        }
    },
});

ScriptManager.register("resources/spikey-ball/cable-script.lua", {
    collision(self) {
        const level = self.getLevel();
        const m = /^(.+)-(.+)$/.exec(self.getId());
        const ball = m ? level.getEntityById("ball-" + m[2]) : null;
        if (ball) {
            self.setGarbage();
            ball.getPositioner().setGravity(new Vector2D(0, 0.003));
            ball.setCollisionChecker(true);
        }
    },
});

/* --- main menu --------------------------------------------------------- */

ScriptManager.register("resources/level-main-menu/play.lua", {
    collision() { common.continue(); },
});

ScriptManager.register("resources/level-main-menu/quit.lua", {
    collision() { InputManager.sendQuitEvent(); },
});

/* --- level scripts ----------------------------------------------------- */

ScriptManager.register("resources/level-intro/tutorial-01.lua", {
    spawn() { effects.staticText(new Vector2D(420, 170), "arrow keys to walk"); },
});
ScriptManager.register("resources/level-intro/tutorial-02.lua",
    tutorial("spacebar to jump", null, new Vector2D(1040, 170)));
ScriptManager.register("resources/level-intro/tutorial-03.lua",
    tutorial("jump on enemies to kill them", new Vector2D(0, -100)));
ScriptManager.register("resources/level-intro/tutorial-04.lua",
    tutorial("do not jump on spikey enemies", new Vector2D(0, -100)));

ScriptManager.register("resources/level-intro/heart.lua", levelExit("resources/level-sea/level.xml"));
ScriptManager.register("resources/level-sea/star.lua", levelExit("resources/level-planet/level.xml"));
ScriptManager.register("resources/level-planet/star.lua", levelExit("resources/level-knife/level.xml"));
ScriptManager.register("resources/level-knife/star.lua", levelExit("resources/level-nostalgia/level.xml"));
ScriptManager.register("resources/level-nostalgia/spiral.lua", levelExit("resources/level-run/level.xml"));
ScriptManager.register("resources/level-run/triforce.lua", levelExit("resources/level-city/level.xml"));
ScriptManager.register("resources/level-city/cloud.lua", levelExit("resources/level-four/level.xml"));
ScriptManager.register("resources/level-contact/girl.lua", levelExit("resources/level-end/level.xml"));

ScriptManager.register("resources/level-four/crown.lua", {
    collision(self, event) {
        const collider = event.getCollider();
        if (common.isPlayer(collider)) {
            let crowns = collider.isSet("crowns") ? Number(collider.get("crowns")) : 0;
            crowns = crowns + 1;
            collider.set("crowns", crowns);
            effects.staticText(self.getPosition().add(new Vector2D(0, -100)), crowns + " out of 4");
            common.dispose(self);
            if (Number(collider.get("crowns")) >= 4) {
                effects.nextLevelAnimation(collider);
                self.setTimer(2000);
            }
        }
    },
    timer() { common.nextLevel("resources/level-contact/level.xml"); },
});

ScriptManager.register("resources/level-four/teleport-to-start.lua", {
    collision(self, event) {
        const collider = event.getCollider();
        if (common.isPlayer(collider)) collider.setPosition(new Vector2D(2425, 1340));
    },
});

// girl.lua in level-end is empty in the original.
ScriptManager.register("resources/level-end/girl.lua", {});

ScriptManager.register("resources/level-end/end.lua", {
    collision(self, event) {
        const collider = event.getCollider();
        if (common.isPlayer(collider) && self.getBool("girl-arrived")) {
            // Player reached the end, prepare for the end.
            collider.setController(null);
            collider.setPositioner(null);
            collider.setVelocity(new Vector2D(0, 0));
            EffectManager.addEffect(new FadeEffect(20000));
            self.setTimer(20000);
            common.dispose(self);
        } else if (collider.getId() === "girl") {
            // Girl reached the end, wait for the player.
            collider.setController(null);
            collider.setVelocity(new Vector2D(0, 0));
            self.setBool("girl-arrived", true);
        }
    },
    timer() {
        common.nextLevel("resources/level-credits/level.xml");
        PersistenceManager.set("level", "resources/level-intro/level.xml");
    },
});
