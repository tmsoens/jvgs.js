# jvg.js

A JavaScript/canvas port of [JVGS](https://github.com/jaspervdj/JVGS) by Jasper Van der Jeugt,
a platformer in which everything is drawn with sketchy, hand-drawn lines.

## Running

Open `index.html` in a browser. It works straight from disk; no server is needed.

Controls: arrow keys to walk, space to jump, left ctrl (or X / Z) to use the item you are carrying,
Esc to quit.

## Layout

| File | Port of |
| --- | --- |
| `js/math.js` | `src/math` – vectors, affine matrices, curves, elliptical arcs, quad tree, the ellipse-space swept collision detector |
| `js/sketch.js` | `src/sketch`, `video/SketchyRenderer` – SVG `<g>`/`<path>` parser and the jittery line renderer |
| `js/platform.js` | SDL/OpenGL/SDL_mixer/FreeType replacements: canvas video manager, keyboard input, audio, localStorage persistence, outline font |
| `js/effects.js` | `src/effect` – particles, text, invert, fade, time effects |
| `js/game.js` | `src/game` – entities, controllers, positioners, cameras, sprites, levels, event queue |
| `js/scripts.js` | the original Lua scripts (`modules/*.lua` and every level/entity script), registered by id (e.g. `level-city/cloud`) as referenced from the XML `script="..."` attributes |
| `js/main.js` | `main.lua` + `LevelManager::run()` |
| `js/resources.js` | generated bundle of `resources/` |

After you change anything in `resources/`, rebuild the bundle:

```sh
node tools/build-resources.mjs
```

The build embeds the SVG/XML files as text and the `.ogg` sounds as data URLs. It also extracts
the glyph outlines from `resources/font.ttf`, which the game draws with the sketchy renderer.

## The game and its levels

`resources/game.xml` lists the menu, the levels in the order they are played, and the credits.
To add a level:

1. Make `resources/level-<name>/level.xml` (and its `world.svg`).
2. Give it an exit: an entity with `script="level-exit"`. Touching it plays the next level
   in `game.xml`. After the last level come the credits, and the save starts over.
3. Add `<level filename="resources/level-<name>/level.xml" />` to `game.xml` where it should be played.
4. Run `node tools/build-resources.mjs`.

Tutorial hints are entities with `script="tutorial"`, configured by entries:

```xml
<entity id="tutorial-02" script="tutorial">
    <position x="1040" y="250" />
    <radius x="100" y="100" />
    <entry key="text" value="spacebar to jump" />
    <entry key="offset-y" value="-80" />   <!-- where the text goes; default 0, -100 -->
    <!-- <entry key="show" value="spawn" />  show at the start instead of on touch -->
</entity>
```

## Tests

```sh
npm test               # node --test, no dependencies (Node 23.4 or later)
npm run test:update    # rewrite the snapshots after an intended change
```

The tests load the real game scripts into a Node `vm` context. Browser APIs (canvas, `Path2D`, audio,
`localStorage`, `DOMParser`) are replaced by small stand-ins in `test/support/`, and `Math.random` is seeded,
so every run is deterministic.

- `test/resources.test.mjs` checks that the bundle matches `resources/`, that every XML file parses, and that
  every file, sound, script id and controller/positioner/camera type it refers to exists.
- `test/levels.test.mjs` loads, simulates and renders every level. It compares the result with
  `levels.test.mjs.snapshot`, which records entity states and a hash of every drawing call.
- `test/gameplay.test.mjs` plays through scenarios: the menu, every level exit and saving, crowns, the
  ending, enemies, each weapon, the controls and `main.js`.

If a snapshot test fails after a change that is *supposed* to alter behaviour or visuals, look at the
diff, then run `npm run test:update` and commit the new snapshots.

## Differences from the original

- **Music**: the original never had its music in git. If you put the files at
  `resources/music/<name>.ogg` and rebuild, they will play.
- **Timing**: updates run at a fixed 60 Hz no matter what the display refresh rate is. The
  original ran at most 60 updates/s using real elapsed time.
- **Quitting**: quitting (Esc, or walking into "quit") shows a screen where Enter starts the game
  again, since a browser tab can't just exit.
- **Saves**: progress is saved in `localStorage` instead of `~/.jvgs.xml`.
- **Item key**: X and Z work as well as left ctrl, because macOS often takes ctrl+arrow for itself.
- **Kept on purpose**: original quirks that affect gameplay or visuals are reproduced as-is: `z`
  doesn't close paths, `H`/`V` path commands are ignored, and the swept bounding-box test and the
  matrix composition order are unchanged.

Original game © Jasper Van der Jeugt, released under the WTFPL (see `LICENSE`).
