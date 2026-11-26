"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");
const scrollerApi = require("../src/scroller.js");

function createMockEnv({ reducedMotion = false } = {}) {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map();

  const target = {
    clientHeight: 800,
    scrollHeight: 4000,
    scrollTop: 0,
    calls: [],
    scrollTo(opts) {
      this.calls.push(opts);
      this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, opts.top));
    },
  };

  const win = {
    innerHeight: 800,
    document: { scrollingElement: target, documentElement: target },
    performance: {
      now: () => now,
    },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(cb) {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      callbacks.delete(id);
    },
  };

  function advance(ms) {
    now += ms;
    const pending = [...callbacks.entries()];
    callbacks.clear();
    for (const [, cb] of pending) {
      cb(now);
    }
  }

  return { win, target, advance };
}

describe("scroller", () => {
  it("scrolls immediately in instant mode with behavior: instant", () => {
    const { win, target } = createMockEnv();
    const scroller = scrollerApi.createScroller(win, core);

    scroller.scroll(target, "halfDown", { smoothScroll: false, scrollRatio: 0.5 });
    assert.equal(target.scrollTop, 400);
    assert.deepEqual(target.calls[0], { top: 400, behavior: "instant" });
    assert.equal(scroller.isAnimating(), false);

    scroller.scroll(target, "bottom", { smoothScroll: false, scrollRatio: 0.5 });
    assert.equal(target.scrollTop, 3200);

    scroller.scroll(target, "top", { smoothScroll: false, scrollRatio: 0.5 });
    assert.equal(target.scrollTop, 0);
  });

  it("accumulates target position across rapid Ctrl+d presses in smooth mode", () => {
    const { win, target, advance } = createMockEnv();
    const scroller = scrollerApi.createScroller(win, core);

    scroller.scroll(target, "halfDown", { smoothScroll: true, scrollRatio: 0.5 });
    assert.equal(scroller.isAnimating(), true);

    advance(50);
    assert.ok(target.scrollTop > 0 && target.scrollTop < 400);

    // Second halfDown while first animation is mid-flight targets 800 (400 + 400)
    scroller.scroll(target, "halfDown", { smoothScroll: true, scrollRatio: 0.5 });
    advance(200);
    assert.equal(target.scrollTop, 800);
    assert.equal(scroller.isAnimating(), false);
  });

  it("respects prefers-reduced-motion even when smoothScroll is true", () => {
    const { win, target } = createMockEnv({ reducedMotion: true });
    const scroller = scrollerApi.createScroller(win, core);

    scroller.scroll(target, "halfDown", { smoothScroll: true, scrollRatio: 0.5 });
    assert.equal(target.scrollTop, 400);
    assert.equal(scroller.isAnimating(), false);
  });

  it("cancels smoothly when user interrupts animation", () => {
    const { win, target, advance } = createMockEnv();
    const scroller = scrollerApi.createScroller(win, core);

    scroller.scroll(target, "bottom", { smoothScroll: true, scrollRatio: 0.5 });
    advance(60);
    const midTop = target.scrollTop;
    assert.ok(midTop > 0 && midTop < 3200);

    scroller.cancel();
    assert.equal(scroller.isAnimating(), false);
    advance(300);
    assert.equal(target.scrollTop, midTop);
  });
});
