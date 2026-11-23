// Gameplay scenarios driven through the real engine: the menu, level
// progression and saving, enemies, weapons and the special level scripts.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGame, entityState, STEP } from "./support/game.mjs";

const MENU = "resources/level-main-menu/main-menu.xml";
const INTRO = "resources/level-intro/level.xml";

/** A game with `file` loaded and the player settled on the ground. */
function playing(file, options) {
    const game = createGame(options);
    game.load(file);
    game.run(1000);
    return game;
}

function vec(game, x, y) { return new (game.get("Vector2D"))(x, y); }

/** Drops the player onto `id` from above. */
function dropOnto(game, id) {
    const target = game.entity(id).getPosition();
    game.player().setPosition(vec(game, target.x, target.y - 70));
    game.player().setVelocity(vec(game, 0, 0));
}

/** Puts the player right next to `id`, at the same height. */
function walkInto(game, id) {
    const target = game.entity(id).getPosition();
    game.player().setPosition(vec(game, target.x - 30, target.y - 15));
}

describe("main menu", () => {
    test("walking right into 'play' starts the intro on a fresh save", () => {
        const game = createGame();
        game.load(MENU);
        game.hold("right");
        assert.ok(game.run(15000, () => game.queuedLevel()), "a level is queued");
        assert.equal(game.queuedLevel(), INTRO);
    });

    test("'play' continues from the saved level", () => {
        const game = createGame({ storage: { jvgs: JSON.stringify({ level: "resources/level-run/level.xml" }) } });
        game.load(MENU);
        game.hold("right");
        game.run(15000, () => game.queuedLevel());
        assert.equal(game.queuedLevel(), "resources/level-run/level.xml");
    });

    test("walking left into 'quit' quits", () => {
        const game = createGame();
        game.load(MENU);
        game.hold("left");
        assert.ok(game.run(15000, () => game.InputManager.hasQuitEvent()));
    });
});

describe("level progression", () => {
    // [level, exit entity, next level]
    const exits = [
        ["resources/level-intro/level.xml", "heart", "resources/level-sea/level.xml"],
        ["resources/level-sea/level.xml", "star", "resources/level-planet/level.xml"],
        ["resources/level-planet/level.xml", "star", "resources/level-knife/level.xml"],
        ["resources/level-knife/level.xml", "star", "resources/level-nostalgia/level.xml"],
        ["resources/level-nostalgia/level.xml", "spiral", "resources/level-run/level.xml"],
        ["resources/level-run/level.xml", "triforce", "resources/level-city/level.xml"],
        ["resources/level-city/level.xml", "cloud", "resources/level-four/level.xml"],
        ["resources/level-contact/level.xml", "girl", "resources/level-end/level.xml"],
    ];
    for (const [file, exit, next] of exits) {
        test(`${file}: touching '${exit}' lifts the player and saves ${next}`, () => {
            const game = playing(file);
            game.teleport(exit);
            game.step(2);
            assert.ok(game.player().getVelocity().y < 0, "the player is lifted");
            assert.equal(game.queuedLevel(), null, "the next level waits for the animation");
            assert.ok(game.run(2500, () => game.queuedLevel()));
            assert.equal(game.queuedLevel(), next);
            assert.deepEqual(JSON.parse(game.storage.get("jvgs")), { level: next });
            assert.ok(game.LevelManager.processQueue());
            assert.ok(game.player(), "the next level loads");
        });
    }

    test("level four: collecting all four crowns leads to level contact", () => {
        const game = playing("resources/level-four/level.xml");
        for (const [i, crown] of ["crown-01", "crown-02", "crown-03", "crown-04"].entries()) {
            game.teleport(crown);
            game.step(2);
            assert.equal(game.player().get("crowns"), String(i + 1));
            const texts = game.get("EffectManager").effects.filter(e => e.text === `${i + 1} out of 4`);
            assert.equal(texts.length, 1, `shows "${i + 1} out of 4"`);
            if (i < 3) {
                game.run(2500);
                assert.equal(game.queuedLevel(), null, "not done yet");
            }
        }
        assert.ok(game.run(2500, () => game.queuedLevel()));
        assert.equal(game.queuedLevel(), "resources/level-contact/level.xml");
    });

    test("level four: the teleporters send the player back to the start", () => {
        const game = playing("resources/level-four/level.xml");
        game.teleport("teleport-02");
        game.step(2);
        const { x, y } = entityState(game.player());
        assert.ok(Math.abs(x - 2425) < 5 && Math.abs(y - 1340) < 5, `player at ${x},${y}`);
    });

    test("the end: once the girl has arrived, reaching her ends the game", () => {
        const game = createGame();
        game.load("resources/level-end/level.xml");
        const end = game.entity("end");
        assert.ok(game.run(120000, () => end.getBool("girl-arrived")), "the girl walks to the end");

        game.teleport("end");
        game.step(2);
        assert.equal(game.player().getController(), null, "the player stops");
        assert.ok(game.get("EffectManager").effects.some(e => e.constructor.name === "FadeEffect"));
        assert.ok(game.run(21000, () => game.queuedLevel()));
        assert.equal(game.queuedLevel(), "resources/level-credits/level.xml");
        assert.deepEqual(JSON.parse(game.storage.get("jvgs")), { level: INTRO }, "the save restarts");
    });

    test("the end: reaching the end before the girl does nothing", () => {
        const game = playing("resources/level-end/level.xml");
        game.teleport("end");
        game.step(2);
        assert.ok(game.player().getController(), "the player keeps control");
        assert.ok(game.player().getPositioner());
        assert.equal(game.get("EffectManager").effects.some(e => e.constructor.name === "FadeEffect"), false);
        assert.equal(game.entity("end").getTimer(), 0, "the ending does not start");
    });
});

describe("enemies", () => {
    test("jumping on an enemy kills it", () => {
        const game = playing(INTRO);
        dropOnto(game, "mouse-01");
        const mouse = game.entity("mouse-01");
        assert.ok(game.run(2000, () => mouse.get("health") === "0"));
        assert.equal(game.player().get("health"), "1");
        assert.deepEqual(game.sounds(), ["resources/mouse/mouse.ogg"]);
        assert.equal(mouse.getController(), null, "the dead enemy stops");
        assert.ok(game.get("EffectManager").effects.length > 10, "stars and text fly");
    });

    test("walking into an enemy kills the player and returns to the menu", () => {
        const game = playing(INTRO);
        walkInto(game, "mouse-01");
        const player = game.player();
        assert.ok(game.run(2000, () => player.get("health") === "0"));
        assert.equal(game.entity("mouse-01").get("health"), "1");
        assert.equal(game.LevelManager.getTimeFactor(), 0.2, "time slows down");
        assert.ok(game.get("EffectManager").effects.some(e => e.constructor.name === "InvertEffect"));
        assert.ok(game.sounds().includes("resources/player/die.ogg"));
        assert.ok(game.run(3000, () => game.queuedLevel()));
        assert.equal(game.queuedLevel(), MENU);
    });

    test("jumping on a spiky enemy kills the player", () => {
        const game = playing(INTRO);
        dropOnto(game, "hedgehog-01");
        assert.ok(game.run(2000, () => game.player().get("health") === "0"));
        assert.equal(game.entity("hedgehog-01").get("health"), "1");
    });

    test("falling out of the world kills the player", () => {
        const game = playing(INTRO);
        const height = game.level().getWorld().getSize().y;
        game.player().setPosition(vec(game, 100, height + 200));
        game.step(1);
        assert.equal(game.player(), null, "the player is removed");
        game.step(1);
        assert.equal(game.queuedLevel(), MENU);
    });

    test("cutting the cable drops the spiky ball", () => {
        const game = playing("resources/level-run/level.xml");
        const ball = game.entity("ball-01");
        const y = ball.getPosition().y;
        game.teleport("cable-01");
        game.step(2);
        assert.equal(game.entity("cable-01"), null, "the cable is gone");
        assert.ok(ball.isCollisionChecker());
        game.run(500);
        assert.ok(ball.getPosition().y > y + 50, "the ball falls");
    });
});

describe("weapons", () => {
    function pickUp(file, pickup) {
        const game = playing(file);
        game.teleport(pickup);
        game.step(2);
        game.player().setPosition(vec(game, game.player().getPosition().x, game.player().getPosition().y - 5));
        game.run(500);
        return game;
    }
    const entityCount = game => game.level().getNumberOfEntities();

    test("knife: pick up, throw, reload", () => {
        const game = pickUp("resources/level-knife/level.xml", "obtain-knife");
        const player = game.player();
        assert.equal(player.get("weapon"), "knife");
        assert.equal(game.entity("obtain-knife"), null, "the pickup disappears");
        assert.ok(game.get("EffectManager").effects.some(e => e.text === "left ctrl to throw a knife"));

        const before = entityCount(game);
        game.tap("action");
        game.step(1);
        assert.equal(entityCount(game), before + 1, "a knife is thrown");
        assert.deepEqual(game.sounds(), ["resources/knife/throw.ogg"]);
        assert.equal(player.getBool("ready"), false);

        game.tap("action");
        game.step(1);
        assert.equal(game.sounds().length, 1, "can't throw again while reloading");

        game.run(2100);
        assert.equal(player.getBool("ready"), true);
        assert.equal(entityCount(game), before, "the knife is gone");
    });

    test("grenade: thrown grenades explode and damage what is near", () => {
        const game = pickUp("resources/level-four/level.xml", "obtain-grenade");
        assert.equal(game.player().get("weapon"), "grenade");
        const before = entityCount(game);
        game.tap("action");
        game.step(1);
        assert.equal(entityCount(game), before + 1, "a grenade is thrown");
        assert.ok(game.run(6000, () => game.sounds().includes("resources/grenade/explosion.ogg")), "it explodes");
        assert.ok(game.get("EffectManager").effects.some(e => e.text === "Boom!"));
    });

    test("grenade: the explosion damages everything within 150 pixels", () => {
        const game = playing("resources/level-four/level.xml");
        const near = game.entity("mouse-01"), far = game.entity("mouse-02");
        // A grenade that stays put 140 px from one mouse and far from the other.
        const grenade = new (game.get("Entity"))(game.level(), "resources/grenade/grenade.xml");
        grenade.setPositioner(null);
        grenade.setCollisionChecker(false);
        grenade.setPosition(near.getPosition().add(vec(game, 140, 0)));
        near.setController(null);
        far.setController(null);
        game.level().addEntity(grenade);
        assert.ok(game.run(6000, () => grenade.isGarbage() || !game.level().entities.includes(grenade)));
        assert.equal(near.get("health"), "0", "the mouse 140 px away dies");
        assert.equal(far.get("health"), "1", "the mouse further away survives");
    });

    test("hat: jumps in the air", () => {
        const game = pickUp("resources/level-city/level.xml", "obtain-hat");
        assert.equal(game.player().get("weapon"), "hat");
        game.tap("action");
        game.step(1);
        assert.ok(game.player().getVelocity().y < -0.5, "the player is launched upwards");
    });

    test("clock: slows down time for a while", () => {
        const game = pickUp("resources/level-four/level.xml", "clock");
        assert.equal(game.player().get("weapon"), "clock");
        game.tap("action");
        game.step(1);
        assert.ok(game.LevelManager.getTimeFactor() < 0.3, "time slows down");
        // The effect lasts 3 s of game time, which is itself slowed down.
        assert.ok(game.run(10000, () => game.LevelManager.getTimeFactor() === 1), "time returns to normal");
        assert.ok(game.run(1000, () => game.player().getBool("ready")), "and the clock can be used again");
    });
});

describe("controls", () => {
    test("arrows walk, space jumps, and the sprite follows", () => {
        const game = playing(INTRO);
        const player = game.player();
        const x = player.getPosition().x;

        game.hold("right");
        game.step(30);
        assert.ok(player.getPosition().x > x + 100, "walks right");
        assert.ok(player.isFacingRight());
        assert.equal(player.getSprite().current, "walking");

        game.release("right");
        game.hold("left");
        game.step(10);
        assert.equal(player.isFacingRight(), false, "turns around");

        game.releaseAll();
        game.run(500);
        assert.equal(player.getSprite().current, "standing");

        const y = player.getPosition().y;
        game.hold("jump");
        game.step(15);
        assert.ok(player.getPosition().y < y - 30, "jumps");
        assert.equal(player.getSprite().current, "falling");
    });

    test("a scripted run through the intro is reproducible", t => {
        const game = createGame({ seed: 3 });
        game.load(INTRO);
        const trace = [];
        game.hold("right");
        for (let i = 0; i < 40; i++) {
            if (i % 3 === 0) game.hold("jump"); else game.release("jump");
            game.run(250);
            trace.push(game.player() ? entityState(game.player()) : null);
        }
        t.assert.snapshot({ trace, queued: game.queuedLevel(), frame: game.render() });
    });
});

describe("main.js", () => {
    test("boots into the main menu, quits on Escape and restarts on Enter", () => {
        const game = createGame({ main: true });
        assert.equal(game.LevelManager.queueFileName, MENU);
        assert.ok(game.player(), "the menu is loaded");

        for (let i = 0; i < 30; i++) assert.ok(game.frame(), "keeps requesting frames");
        assert.ok(game.canvas.width > 0 && game.ctx2d.strokes > 0, "renders to the canvas");

        game.dispatch("keydown", { code: "Escape" });
        game.frame();
        assert.equal(game.pendingFrames(), 0, "the loop stops on quit");

        game.dispatch("keydown", { code: "Enter" });
        assert.equal(game.pendingFrames(), 1, "Enter restarts the loop");
        assert.equal(game.InputManager.hasQuitEvent(), false);
        assert.ok(game.frame());
        assert.ok(game.player(), "the menu is loaded again");
    });

    test("runs at a fixed 60 Hz no matter the frame rate", () => {
        const game = createGame({ main: true });
        game.hold("right");
        game.frame(1000 / 30); // a 30 fps frame = two steps
        const afterOne = game.player().getPosition().x;
        const slow = createGame({ main: true });
        slow.hold("right");
        slow.frame(STEP);
        slow.frame(STEP);
        assert.equal(slow.player().getPosition().x, afterOne);
    });
});
