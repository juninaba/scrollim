"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const coreSource = fs.readFileSync(
  path.resolve(__dirname, "../src/core.js"),
  "utf8"
);
const scrollerSource = fs.readFileSync(
  path.resolve(__dirname, "../src/scroller.js"),
  "utf8"
);
const contentScriptSource = fs.readFileSync(
  path.resolve(__dirname, "../src/content.js"),
  "utf8"
);

function createContentHarness({
  hostname = "example.com",
  ancestorOrigins = [],
  crossOriginTop = false,
  docScrollTop = 500,
  docScrollHeight = 3000,
  htmlStyle = { overflowX: "visible", overflowY: "visible", display: "block", visibility: "visible" },
  bodyStyle = { overflowX: "visible", overflowY: "visible", display: "block", visibility: "visible" },
  bodyScrollHeight = 800,
  bodyScrollTop = 0,
  innerPane = null,
  closedShadowMap = null,
} = {}) {
  const listeners = new Map();
  let storageCallbacks = [];
  let storageChangeListener = null;
  let rafCallbacks = new Map();
  let nextRafId = 1;
  let now = 0;

  const se = {
    nodeType: 1,
    tagName: "HTML",
    clientWidth: 1280,
    clientHeight: 800,
    scrollHeight: docScrollHeight,
    scrollTop: docScrollTop,
    isConnected: true,
    scrollTo(opts) {
      this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, opts.top));
    },
  };
  const body = {
    nodeType: 1,
    tagName: "BODY",
    clientWidth: 1280,
    clientHeight: 800,
    scrollHeight: bodyScrollHeight,
    scrollTop: bodyScrollTop,
    parentElement: se,
    isConnected: true,
    scrollTo(opts) {
      this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, opts.top));
    },
  };

  if (innerPane) {
    innerPane.parentElement = body;
  }

  const documentMock = {
    scrollingElement: se,
    documentElement: se,
    body,
    activeElement: body,
    hidden: false,
    addEventListener(type, fn) {
      if (!listeners.has("doc:" + type)) listeners.set("doc:" + type, []);
      listeners.get("doc:" + type).push(fn);
    },
    querySelectorAll: () => [body, ...(innerPane ? [innerPane] : [])],
  };

  const windowMock = {
    innerWidth: 1280,
    innerHeight: 800,
    document: documentMock,
    location: { hostname, ancestorOrigins },
    performance: { now: () => now },
    matchMedia: () => ({ matches: false }),
    getComputedStyle(el) {
      if (el === se) return htmlStyle;
      if (el === body) return bodyStyle;
      if (el === innerPane) {
        return { overflowX: "visible", overflowY: "auto", display: "block", visibility: "visible" };
      }
      return { overflowX: "visible", overflowY: "visible", display: "block", visibility: "visible" };
    },
    addEventListener(type, fn) {
      if (!listeners.has("win:" + type)) listeners.set("win:" + type, []);
      listeners.get("win:" + type).push(fn);
    },
    requestAnimationFrame(cb) {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    },
  };

  windowMock.top = crossOriginTop
    ? {
        get location() {
          throw new Error("SecurityError");
        },
      }
    : windowMock;

  const chromeMock = {
    runtime: { lastError: null },
    dom: closedShadowMap
      ? {
          openOrClosedShadowRoot(el) {
            return closedShadowMap.get(el) || null;
          },
        }
      : undefined,
    storage: {
      sync: {
        get(_defaults, cb) {
          storageCallbacks.push(cb);
        },
      },
      onChanged: {
        addListener(fn) {
          storageChangeListener = fn;
        },
      },
    },
  };

  const sandbox = {
    window: windowMock,
    document: documentMock,
    chrome: chromeMock,
    URL,
    Date,
    setTimeout: () => 0,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(coreSource, sandbox);
  vm.runInNewContext(scrollerSource, sandbox);
  vm.runInNewContext(contentScriptSource, sandbox);

  function dispatch(targetPrefix, type, event) {
    for (const fn of listeners.get(targetPrefix + ":" + type) || []) {
      fn(event);
    }
  }

  function pressKey(overrides) {
    let prevented = false;
    const target = overrides.target || body;
    const ev = {
      key: "",
      code: "",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      isTrusted: true,
      keyCode: 0,
      target,
      composedPath: () => [target],
      preventDefault() {
        prevented = true;
      },
      stopPropagation() {},
      ...overrides,
    };
    dispatch("win", "keydown", ev);
    return { prevented };
  }

  return {
    se,
    body,
    doc: documentMock,
    resolveStorage(stored, error = null) {
      const cb = storageCallbacks.shift();
      assert.ok(cb, "expected storage.sync.get to be called");
      chromeMock.runtime.lastError = error;
      cb(stored);
      chromeMock.runtime.lastError = null;
    },
    emitStorageChange(changes) {
      assert.ok(storageChangeListener);
      storageChangeListener(changes, "sync");
    },
    clickElement(el) {
      dispatch("win", "pointerdown", { target: el, composedPath: () => [el] });
    },
    pressKey,
    advanceRaf(ms) {
      now += ms;
      const pending = [...rafCallbacks.entries()];
      rafCallbacks.clear();
      for (const [, cb] of pending) cb(now);
    },
  };
}

describe("content script integration", () => {
  it("gates shortcuts until initial settings load, preventing leaks on paused sites", () => {
    const h = createContentHarness({ hostname: "paused.example", docScrollTop: 500 });

    const beforeLoad = h.pressKey({ key: "d", ctrlKey: true });
    assert.equal(beforeLoad.prevented, false);
    assert.equal(h.se.scrollTop, 500);

    h.resolveStorage({
      enabled: true,
      smoothScroll: false,
      scrollRatio: 0.5,
      disabledHosts: ["paused.example"],
    });

    const afterLoad = h.pressKey({ key: "d", ctrlKey: true });
    assert.equal(afterLoad.prevented, false);
    assert.equal(h.se.scrollTop, 500);
  });

  it("recovers from an initial storage.sync.get error when storage changes later", () => {
    const h = createContentHarness({ hostname: "example.com", docScrollTop: 500 });

    // Initial get fails -> stays fail-closed
    h.resolveStorage(undefined, { message: "transient error" });
    assert.equal(h.pressKey({ key: "d", ctrlKey: true }).prevented, false);
    assert.equal(h.se.scrollTop, 500);

    // User changes settings in popup -> onChanged triggers fresh get
    h.emitStorageChange({ enabled: { newValue: true } });
    h.resolveStorage({
      enabled: true,
      smoothScroll: false,
      scrollRatio: 0.5,
      disabledHosts: [],
    });

    assert.equal(h.pressKey({ key: "d", ctrlKey: true }).prevented, true);
    assert.equal(h.se.scrollTop, 900);
  });

  it("pauses inside cross-origin iframes when the top-level tab hostname is paused", () => {
    const h = createContentHarness({
      hostname: "embed.thirdparty.test",
      ancestorOrigins: ["https://docs.example.com"],
      crossOriginTop: true,
      docScrollTop: 500,
    });

    h.resolveStorage({
      enabled: true,
      smoothScroll: false,
      scrollRatio: 0.5,
      disabledHosts: ["docs.example.com"],
    });

    const res = h.pressKey({ key: "G", shiftKey: true });
    assert.equal(res.prevented, false);
    assert.equal(h.se.scrollTop, 500);
  });

  it("does not intercept shortcuts inside text inputs, contenteditable, or closed Shadow DOM", () => {
    const closedInput = { nodeType: 1, tagName: "INPUT", type: "text" };
    const closedHost = { nodeType: 1, tagName: "X-FIELD", shadowRoot: null };
    const h = createContentHarness({
      docScrollTop: 500,
      closedShadowMap: new Map([[closedHost, { activeElement: closedInput }]]),
    });
    h.resolveStorage({ enabled: true, smoothScroll: false, scrollRatio: 0.5, disabledHosts: [] });

    const textInput = { nodeType: 1, tagName: "INPUT", type: "text" };
    assert.equal(h.pressKey({ key: "d", ctrlKey: true, target: textInput }).prevented, false);
    assert.equal(h.pressKey({ key: "u", ctrlKey: true, target: textInput }).prevented, false);
    assert.equal(h.pressKey({ key: "G", shiftKey: true, target: textInput }).prevented, false);

    const editableDiv = { nodeType: 1, tagName: "DIV", isContentEditable: true };
    assert.equal(h.pressKey({ key: "G", shiftKey: true, target: editableDiv }).prevented, false);
    assert.equal(h.pressKey({ key: "d", ctrlKey: true, target: editableDiv }).prevented, false);

    // Closed shadow root host with focused input inside
    h.doc.activeElement = closedHost;
    assert.equal(h.pressKey({ key: "G", shiftKey: true, target: closedHost }).prevented, false);
    assert.equal(h.pressKey({ key: "g", target: closedHost }).prevented, false);
    assert.equal(h.pressKey({ key: "g", target: closedHost }).prevented, false);
    assert.equal(h.se.scrollTop, 500);
  });

  it("scrolls body when html has overflow:hidden and body is the scroll container", () => {
    const h = createContentHarness({
      docScrollHeight: 800,
      docScrollTop: 0,
      htmlStyle: { overflowX: "hidden", overflowY: "hidden", display: "block", visibility: "visible" },
      bodyStyle: { overflowX: "visible", overflowY: "auto", display: "block", visibility: "visible" },
      bodyScrollHeight: 2400,
      bodyScrollTop: 0,
    });
    h.resolveStorage({ enabled: true, smoothScroll: false, scrollRatio: 0.5, disabledHosts: [] });

    assert.equal(h.pressKey({ key: "d", ctrlKey: true }).prevented, true);
    assert.equal(h.body.scrollTop, 400);
    assert.equal(h.se.scrollTop, 0);
  });

  it("ignores untrusted synthetic key events and cancels smooth animation on other keys", () => {
    const h = createContentHarness({ docScrollTop: 0 });
    h.resolveStorage({ enabled: true, smoothScroll: true, scrollRatio: 0.5, disabledHosts: [] });

    // Synthetic event is ignored
    assert.equal(h.pressKey({ key: "d", ctrlKey: true, isTrusted: false }).prevented, false);
    assert.equal(h.se.scrollTop, 0);

    // Start smooth scroll, advance midway, press PageDown -> cancels animation
    assert.equal(h.pressKey({ key: "d", ctrlKey: true }).prevented, true);
    h.advanceRaf(50);
    const midTop = h.se.scrollTop;
    assert.ok(midTop > 0 && midTop < 400);

    // Pressing Control modifier alone should NOT cancel
    h.pressKey({ key: "Control", ctrlKey: true });
    h.pressKey({ key: "PageDown" });
    h.advanceRaf(300);
    assert.equal(h.se.scrollTop, midTop);

    // Holding Shift+G (auto-repeat during 220ms jump) should NOT cancel the jump
    assert.equal(h.pressKey({ key: "G", shiftKey: true }).prevented, true);
    h.advanceRaf(100);
    assert.equal(h.pressKey({ key: "G", shiftKey: true, repeat: true }).prevented, true);
    h.advanceRaf(150);
    assert.equal(h.se.scrollTop, 2200);

    // Holding second g after gg (auto-repeat during 220ms jump) should NOT cancel the jump
    assert.equal(h.pressKey({ key: "g" }).prevented, false);
    assert.equal(h.pressKey({ key: "g" }).prevented, true);
    h.advanceRaf(100);
    assert.equal(h.pressKey({ key: "g", repeat: true }).prevented, false);
    h.advanceRaf(150);
    assert.equal(h.se.scrollTop, 0);
  });

  it("reverses pending inner-pane animation on immediate Ctrl+d then Ctrl+u without scrolling outer document", () => {
    const pane = {
      nodeType: 1,
      tagName: "DIV",
      clientWidth: 600,
      clientHeight: 200,
      scrollHeight: 1000,
      scrollTop: 0,
      isConnected: true,
      scrollTo(opts) {
        this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, opts.top));
      },
    };
    const child = {
      nodeType: 1,
      tagName: "P",
      parentElement: pane,
      isConnected: true,
    };

    const h = createContentHarness({ docScrollTop: 500, innerPane: pane });
    h.resolveStorage({
      enabled: true,
      smoothScroll: true,
      scrollRatio: 0.5,
      disabledHosts: [],
    });

    h.clickElement(child);

    // Ctrl+d queues smooth scroll of pane from 0 -> 100 (pane.scrollTop is still 0)
    const down = h.pressKey({ key: "d", ctrlKey: true });
    assert.equal(down.prevented, true);
    assert.equal(pane.scrollTop, 0);

    // Immediate Ctrl+u reverses pane instead of bubbling to outer document
    const up = h.pressKey({ key: "u", ctrlKey: true });
    assert.equal(up.prevented, true);

    h.advanceRaf(300);
    assert.equal(pane.scrollTop, 0);
    assert.equal(h.se.scrollTop, 500);
  });

  it("finishes nested pane edge animation on repeated Ctrl+d before bubbling to outer document", () => {
    const pane = {
      nodeType: 1,
      tagName: "DIV",
      clientWidth: 600,
      clientHeight: 200,
      scrollHeight: 1000, // maxTop = 800
      scrollTop: 750,
      isConnected: true,
      scrollTo(opts) {
        this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, opts.top));
      },
    };
    const child = {
      nodeType: 1,
      tagName: "P",
      parentElement: pane,
      isConnected: true,
    };

    const h = createContentHarness({ docScrollTop: 500, innerPane: pane });
    h.resolveStorage({
      enabled: true,
      smoothScroll: true,
      scrollRatio: 0.5,
      disabledHosts: [],
    });

    h.clickElement(child);

    // First Ctrl+d queues 750 -> 800; second Ctrl+d 50ms later keeps pane selected
    // and lets the original 150ms animation finish on schedule (100ms later) without restarting
    assert.equal(h.pressKey({ key: "d", ctrlKey: true }).prevented, true);
    h.advanceRaf(50);
    assert.ok(pane.scrollTop > 750 && pane.scrollTop < 800);
    assert.equal(h.pressKey({ key: "d", ctrlKey: true }).prevented, true);

    h.advanceRaf(100);
    assert.equal(pane.scrollTop, 800);
    assert.equal(h.se.scrollTop, 500);

    // Once pane reached 800, a subsequent Ctrl+d bubbles to outer document
    assert.equal(h.pressKey({ key: "d", ctrlKey: true }).prevented, true);
    h.advanceRaf(150);
    assert.equal(h.se.scrollTop, 900);
  });
});
