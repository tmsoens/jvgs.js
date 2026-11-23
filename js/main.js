// Entry point - port of main.lua and LevelManager::run().
"use strict";

(function () {
    const STEP = 1000 / 60;   // The original capped the loop at 60 updates/s.
    const MAX_STEPS = 5;      // Avoid a spiral of death after a stall.

    const canvas = document.getElementById("game");
    VideoManager.init(canvas);
    InputManager.init();
    PersistenceManager.load();
    FontManager.addFont("regular", new Font(window.JVGS_RESOURCES.font));

    let quitFont = null;
    let accumulator = 0;
    let last = performance.now();
    let running = true;

    function frame(now) {
        if (!running) return;
        accumulator += Math.min(now - last, STEP * MAX_STEPS);
        last = now;

        let steps = 0;
        while (accumulator >= STEP && steps < MAX_STEPS) {
            LevelManager.step(STEP);
            accumulator -= STEP;
            steps++;
            if (InputManager.hasQuitEvent()) break;
        }

        LevelManager.render(VideoManager);

        if (LevelManager.processQueue()) {
            // Loading may take a while; skip the time it took.
            last = performance.now();
            accumulator = 0;
        }

        if (InputManager.hasQuitEvent()) {
            quit();
            return;
        }
        requestAnimationFrame(frame);
    }

    // The original simply exited. In a browser tab we show a goodbye screen
    // and allow starting over.
    function quit() {
        running = false;
        AudioManager.stopMusic();
        const video = VideoManager;
        quitFont = quitFont || FontManager.getFont("regular");
        video.setColor(new Color(0, 0, 0));
        video.setClearColor(new Color(1, 1, 1));
        video.clear();
        video.identity();
        const lines = ["thanks for playing", "press enter to play again"];
        lines.forEach((line, i) => {
            video.push();
            video.translate(new Vector2D(
                (video.getSize().x - quitFont.getStringWidth(line)) / 2,
                video.getSize().y / 2 + (i - 0.5) * 60));
            quitFont.drawString(video, line);
            video.pop();
        });
        const restart = e => {
            if (e.code !== "Enter" && e.code !== "NumpadEnter") return;
            window.removeEventListener("keydown", restart);
            InputManager.quitEvent = false;
            EffectManager.clear();
            LevelManager.queueLevel(GameManager.getMenu());
            LevelManager.processQueue();
            running = true;
            last = performance.now();
            accumulator = 0;
            requestAnimationFrame(frame);
        };
        window.addEventListener("keydown", restart);
    }

    LevelManager.queueLevel(GameManager.getMenu());
    LevelManager.processQueue();
    requestAnimationFrame(frame);
})();
