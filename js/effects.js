// jvgs::effect - port of src/effect/*.cpp.
// C++ destructors become destroy(), called when an effect is removed.
"use strict";

const EffectManager = {
    effects: [],
    addEffect(effect) { this.effects.push(effect); },
    clear() {
        for (const e of this.effects) e.destroy();
        this.effects = [];
    },
    update(ms) {
        const remaining = [];
        for (const e of this.effects) {
            e.update(ms);
            if (!e.garbage) remaining.push(e);
            else e.destroy();
        }
        this.effects = remaining;
    },
    render(video) {
        for (const e of this.effects) e.render(video);
    },
};

/** An effect with a limited life time; life <= 0 means immortal. */
class LifeEffect {
    constructor(life) {
        this.initialLife = life;
        this.life = life;
        this.garbage = false;
    }
    update(ms) {
        if (this.life > 0) {
            if (this.life - ms <= 0) this.garbage = true;
            else this.life -= ms;
        }
    }
    getLifeFraction() { return this.life / this.initialLife; }
    isImmortal() { return this.life <= 0; }
    render() {}
    destroy() {}
}

class ColorEffect extends LifeEffect {
    constructor(color, clearColor, life) {
        super(life);
        this.originalColor = VideoManager.getColor();
        this.originalClearColor = VideoManager.getClearColor();
        VideoManager.setColor(color);
        VideoManager.setClearColor(clearColor);
    }
    destroy() {
        VideoManager.setColor(this.originalColor);
        VideoManager.setClearColor(this.originalClearColor);
    }
}

/** Fades the drawing color into the clear color. */
class FadeEffect extends LifeEffect {
    constructor(life = 5000) {
        super(life);
        this.color = VideoManager.getColor();
    }
    render() {
        const t0 = this.getLifeFraction(), t1 = 1 - t0;
        const clear = VideoManager.getClearColor(), c = this.color;
        VideoManager.setColor(new Color(
            c.red * t0 + clear.red * t1, c.green * t0 + clear.green * t1,
            c.blue * t0 + clear.blue * t1, c.alpha * t0 + clear.alpha * t1));
    }
    destroy() { VideoManager.setColor(this.color); }
}

/** Swaps drawing and clear colors for a while (death effect). */
class InvertEffect extends LifeEffect {
    constructor(life = 5000) {
        super(life);
        VideoManager.invert();
    }
    destroy() { VideoManager.invert(); }
}

class Particle extends LifeEffect {
    constructor(sketch, life, position, velocity, gravity) {
        super(life);
        this.sketch = sketch;
        this.position = position.clone();
        this.velocity = velocity.clone();
        this.gravity = gravity.clone();
    }
    update(ms) {
        super.update(ms);
        this.position = this.position.add(this.velocity.mul(ms));
        this.velocity = this.velocity.add(this.gravity.mul(ms));
    }
    render(video) {
        video.push();
        video.translate(this.position);
        this.sketch.render(video);
        video.pop();
    }
}

class TextEffect extends LifeEffect {
    constructor(text, position, life, rotationSpeed, rotation) {
        super(life);
        this.text = text;
        this.position = position.clone();
        this.rotationSpeed = MathManager.randBool() ? rotationSpeed : -rotationSpeed;
        this.rotation = rotation;
        this.font = FontManager.getFont("effect") || FontManager.getFont("regular");
        this.width = this.font.getStringWidth(text);
    }
    update(ms) {
        super.update(ms);
        this.rotation += this.rotationSpeed * ms;
        if (this.rotation > 360) this.rotation -= Math.trunc(this.rotation / 360) * 360;
    }
    render(video) {
        video.push();
        video.translate(this.position);
        video.rotate(this.rotation);
        video.translate(new Vector2D(-this.width * 0.5, 0));
        this.font.drawString(video, this.text);
        video.pop();
    }
}

/** Slows down (or speeds up) time, easing back to normal. */
class TimeEffect extends LifeEffect {
    constructor(timeFactor, life) {
        super(life);
        this.timeFactor = timeFactor;
        LevelManager.setTimeFactor(timeFactor);
    }
    update(ms) {
        super.update(ms);
        if (this.isImmortal()) {
            LevelManager.setTimeFactor(this.timeFactor);
        } else {
            LevelManager.setTimeFactor((this.timeFactor - 1) * this.getLifeFraction() + 1);
        }
    }
    destroy() { LevelManager.setTimeFactor(1); }
}
