// Every level loads, simulates and renders headless without errors, and its
// deterministic outcome matches the stored snapshot.
//
// The snapshots (levels.test.mjs.snapshot) pin down loading, physics, AI and
// the sketchy renderer. If a change is *meant* to alter behaviour or visuals,
// review the diff and refresh them with `npm run test:update`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGame, levelFiles, levelState } from "./support/game.mjs";

const LEVELS = levelFiles();

test("all levels are discovered", () => {
    assert.deepEqual(LEVELS, [
        "resources/level-city/level.xml",
        "resources/level-contact/level.xml",
        "resources/level-credits/level.xml",
        "resources/level-end/level.xml",
        "resources/level-four/level.xml",
        "resources/level-intro/level.xml",
        "resources/level-knife/level.xml",
        "resources/level-main-menu/main-menu.xml",
        "resources/level-nostalgia/level.xml",
        "resources/level-planet/level.xml",
        "resources/level-run/level.xml",
        "resources/level-sea/level.xml",
    ]);
});

describe("levels", () => {
    for (const file of LEVELS) {
        test(file, t => {
            const game = createGame({ seed: 42 });
            const level = game.load(file);

            assert.ok(level.getWorld(), "has a world");
            assert.ok(level.getCollisionDetector(), "has a collision detector");
            assert.ok(level.camera, "has a camera");
            assert.ok(game.player(), "has a player");
            const firstFrame = game.render();
            assert.ok(game.ctx2d.strokes > 0, "draws something");
            const initial = levelState(game);

            const player = game.player();
            assert.ok(game.run(3000, () => !player.isFalling()), "the player lands on solid ground");

            // Ten idle seconds: enemies patrol, the girl walks, things fall.
            game.run(10000);
            const later = levelState(game);
            const lastFrame = game.render();

            assert.deepEqual(game.logs.error, [], "no errors were logged");
            assert.deepEqual(game.logs.warn.filter(w => !w.startsWith("Could not open music")), [],
                "no warnings other than missing music");

            t.assert.snapshot({ firstFrame, lastFrame, initial, later, queued: game.queuedLevel() });
        });
    }
});

test("a level is deterministic for a given seed", () => {
    const run = seed => {
        const game = createGame({ seed });
        game.load("resources/level-nostalgia/level.xml");
        game.run(3000);
        return { frame: game.render(), state: levelState(game) };
    };
    assert.deepEqual(run(7), run(7));
});
