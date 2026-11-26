"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../src/core.js");

function makeKeyEvent(overrides = {}) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    ...overrides,
  };
}

function makeElement(overrides = {}) {
  const attrs = overrides.attrs || {};
  return {
    nodeType: 1,
    tagName: overrides.tagName || "DIV",
    type: overrides.type,
    isContentEditable: overrides.isContentEditable,
    clientHeight: overrides.clientHeight ?? 0,
    clientWidth: overrides.clientWidth ?? 0,
    scrollHeight: overrides.scrollHeight ?? 0,
    scrollTop: overrides.scrollTop ?? 0,
    parentElement: overrides.parentElement ?? null,
    isConnected: overrides.isConnected ?? true,
    shadowRoot: overrides.shadowRoot ?? null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name)
        ? attrs[name]
        : null;
    },
    getRootNode() {
      return overrides.rootNode || null;
    },
    getBoundingClientRect() {
      return (
        overrides.rect || {
          left: 0,
          top: 0,
          right: overrides.clientWidth ?? 0,
          bottom: overrides.clientHeight ?? 0,
        }
      );
    },
  };
}

describe("resolveKeyAction", () => {
  it("triggers top on gg within timeout", () => {
    let state = core.createKeyState();
    const first = core.resolveKeyAction(makeKeyEvent({ key: "g" }), state, 1000, 500);
    assert.equal(first.action, null);
    assert.equal(first.preventDefault, false);
    assert.equal(first.nextState.lastGTime, 1000);

    const second = core.resolveKeyAction(
      makeKeyEvent({ key: "g" }),
      first.nextState,
      1400,
      500
    );
    assert.equal(second.action, "top");
    assert.equal(second.preventDefault, true);
    assert.equal(second.nextState.lastGTime, 0);
  });

  it("does not trigger top when second g exceeds timeout and restarts sequence", () => {
    const first = core.resolveKeyAction(
      makeKeyEvent({ key: "g" }),
      core.createKeyState(),
      1000,
      500
    );
    const late = core.resolveKeyAction(
      makeKeyEvent({ key: "g" }),
      first.nextState,
      1600,
      500
    );
    assert.equal(late.action, null);
    assert.equal(late.preventDefault, false);
    assert.equal(late.nextState.lastGTime, 1600);

    const third = core.resolveKeyAction(
      makeKeyEvent({ key: "g" }),
      late.nextState,
      1800,
      500
    );
    assert.equal(third.action, "top");
  });

  it("ignores repeated g key events so holding g does not jump to top", () => {
    const first = core.resolveKeyAction(
      makeKeyEvent({ key: "g" }),
      core.createKeyState(),
      1000,
      500
    );
    const held = core.resolveKeyAction(
      makeKeyEvent({ key: "g", repeat: true }),
      first.nextState,
      1100,
      500
    );
    assert.equal(held.action, null);
    assert.equal(held.preventDefault, false);
    assert.equal(held.nextState.lastGTime, 0);
  });

  it("cancels pending g when another non-modifier key is pressed", () => {
    const first = core.resolveKeyAction(
      makeKeyEvent({ key: "g" }),
      core.createKeyState(),
      1000,
      500
    );
    const other = core.resolveKeyAction(
      makeKeyEvent({ key: "i" }),
      first.nextState,
      1100,
      500
    );
    assert.equal(other.action, null);
    assert.equal(other.nextState.lastGTime, 0);

    const nextG = core.resolveKeyAction(
      makeKeyEvent({ key: "g" }),
      other.nextState,
      1200,
      500
    );
    assert.equal(nextG.action, null);
    assert.equal(nextG.nextState.lastGTime, 1200);
  });

  it("triggers bottom on Shift+G (and Shift+g with CapsLock)", () => {
    const res1 = core.resolveKeyAction(
      makeKeyEvent({ key: "G", shiftKey: true }),
      core.createKeyState(),
      1000,
      500
    );
    assert.equal(res1.action, "bottom");
    assert.equal(res1.preventDefault, true);

    const resCaps = core.resolveKeyAction(
      makeKeyEvent({ key: "g", shiftKey: true }),
      core.createKeyState(),
      1000,
      500
    );
    assert.equal(resCaps.action, "bottom");
    assert.equal(resCaps.preventDefault, true);

    const resRepeat = core.resolveKeyAction(
      makeKeyEvent({ key: "G", shiftKey: true, repeat: true }),
      core.createKeyState(),
      1050,
      500
    );
    assert.equal(resRepeat.action, null);
    assert.equal(resRepeat.preventDefault, true);
  });

  it("does not trigger bottom on plain G without Shift (CapsLock without Shift)", () => {
    const res = core.resolveKeyAction(
      makeKeyEvent({ key: "G", shiftKey: false }),
      core.createKeyState(),
      1000,
      500
    );
    assert.equal(res.action, null);
    assert.equal(res.preventDefault, false);
  });

  it("triggers halfDown on Ctrl+d and halfUp on Ctrl+u, including repeats", () => {
    const down = core.resolveKeyAction(
      makeKeyEvent({ key: "d", ctrlKey: true }),
      core.createKeyState(),
      1000,
      500
    );
    assert.equal(down.action, "halfDown");
    assert.equal(down.preventDefault, true);

    const downRepeat = core.resolveKeyAction(
      makeKeyEvent({ key: "D", ctrlKey: true, repeat: true }),
      core.createKeyState(),
      1050,
      500
    );
    assert.equal(downRepeat.action, "halfDown");
    assert.equal(downRepeat.preventDefault, true);

    const up = core.resolveKeyAction(
      makeKeyEvent({ key: "u", ctrlKey: true }),
      core.createKeyState(),
      1100,
      500
    );
    assert.equal(up.action, "halfUp");
    assert.equal(up.preventDefault, true);

    // Non-Latin layout fallback via physical code (e.g. Cyrillic Ctrl+в / Ctrl+г)
    const nonLatinDown = core.resolveKeyAction(
      makeKeyEvent({ key: "в", code: "KeyD", ctrlKey: true }),
      core.createKeyState(),
      1200,
      500
    );
    assert.equal(nonLatinDown.action, "halfDown");
    const nonLatinUp = core.resolveKeyAction(
      makeKeyEvent({ key: "г", code: "KeyU", ctrlKey: true }),
      core.createKeyState(),
      1250,
      500
    );
    assert.equal(nonLatinUp.action, "halfUp");

    // Non-QWERTY Latin layouts (e.g. Dvorak Ctrl+e on physical KeyD) do not misfire
    const dvorakE = core.resolveKeyAction(
      makeKeyEvent({ key: "e", code: "KeyD", ctrlKey: true }),
      core.createKeyState(),
      1300,
      500
    );
    assert.equal(dvorakE.action, null);
  });

  it("ignores other Vim keys like j, k, h, l, f and extra modifiers", () => {
    const ignoredEvents = [
      makeKeyEvent({ key: "j" }),
      makeKeyEvent({ key: "k" }),
      makeKeyEvent({ key: "h" }),
      makeKeyEvent({ key: "l" }),
      makeKeyEvent({ key: "f" }),
      makeKeyEvent({ key: "d", metaKey: true }),
      makeKeyEvent({ key: "u", metaKey: true }),
      makeKeyEvent({ key: "d", ctrlKey: true, shiftKey: true }),
      makeKeyEvent({ key: "u", ctrlKey: true, altKey: true }),
      makeKeyEvent({ key: "g", ctrlKey: true }),
      makeKeyEvent({ key: "G", ctrlKey: true, shiftKey: true }),
    ];

    for (const ev of ignoredEvents) {
      const res = core.resolveKeyAction(ev, core.createKeyState(), 1000, 500);
      assert.equal(res.action, null);
      assert.equal(res.preventDefault, false);
    }
  });

  it("ignores IME composing events", () => {
    const res1 = core.resolveKeyAction(
      makeKeyEvent({ key: "g", isComposing: true }),
      { lastGTime: 900 },
      1000,
      500
    );
    assert.equal(res1.action, null);
    assert.equal(res1.nextState.lastGTime, 0);

    const res2 = core.resolveKeyAction(
      makeKeyEvent({ key: "G", shiftKey: true, keyCode: 229 }),
      core.createKeyState(),
      1000,
      500
    );
    assert.equal(res2.action, null);
  });
});

describe("isEventFromEditable", () => {
  it("detects text inputs, textarea, select, contenteditable, and ARIA textbox", () => {
    const editableTargets = [
      makeElement({ tagName: "INPUT", type: "text" }),
      makeElement({ tagName: "INPUT", type: "search" }),
      makeElement({ tagName: "INPUT", type: "email" }),
      makeElement({ tagName: "TEXTAREA" }),
      makeElement({ tagName: "SELECT" }),
      makeElement({ tagName: "DIV", isContentEditable: true }),
      makeElement({ tagName: "DIV", attrs: { contenteditable: "" } }),
      makeElement({ tagName: "DIV", attrs: { role: "textbox" } }),
      makeElement({ tagName: "DIV", attrs: { role: "searchbox" } }),
      makeElement({ tagName: "DIV", attrs: { role: "combobox" } }),
    ];

    for (const target of editableTargets) {
      assert.equal(
        core.isEventFromEditable({ target, composedPath: () => [target] }, {}),
        true
      );
    }
  });

  it("allows scrolling on non-text inputs and normal elements", () => {
    const nonEditableTargets = [
      makeElement({ tagName: "DIV", isContentEditable: false }),
      makeElement({ tagName: "BUTTON", isContentEditable: false }),
      makeElement({ tagName: "INPUT", type: "checkbox", isContentEditable: false }),
      makeElement({ tagName: "INPUT", type: "radio", isContentEditable: false }),
      makeElement({ tagName: "INPUT", type: "submit", isContentEditable: false }),
    ];

    for (const target of nonEditableTargets) {
      assert.equal(
        core.isEventFromEditable({ target, composedPath: () => [target] }, {}),
        false
      );
    }
  });

  it("detects inputs inside Shadow DOM via activeElement and composedPath", () => {
    const shadowInput = makeElement({ tagName: "INPUT", type: "text" });
    const shadowHost = makeElement({
      tagName: "CUSTOM-SEARCH",
      shadowRoot: { activeElement: shadowInput },
    });

    assert.equal(
      core.isEventFromEditable(
        { target: shadowHost, composedPath: () => [shadowInput, shadowHost] },
        { activeElement: shadowHost }
      ),
      true
    );

    assert.equal(
      core.isEventFromEditable(
        { target: shadowHost },
        { activeElement: shadowHost }
      ),
      true
    );
  });

  it("detects inputs inside closed Shadow DOM via chrome.dom.openOrClosedShadowRoot", () => {
    const closedInput = makeElement({ tagName: "INPUT", type: "text" });
    const closedHost = makeElement({ tagName: "CLOSED-INPUT", shadowRoot: null });
    const prevChrome = globalThis.chrome;
    globalThis.chrome = {
      dom: {
        openOrClosedShadowRoot: (el) =>
          el === closedHost ? { activeElement: closedInput } : null,
      },
    };
    try {
      assert.equal(
        core.isEventFromEditable(
          { target: closedHost, composedPath: () => [closedHost] },
          { activeElement: closedHost }
        ),
        true
      );
    } finally {
      if (prevChrome === undefined) {
        delete globalThis.chrome;
      } else {
        globalThis.chrome = prevChrome;
      }
    }
  });

  it("respects contenteditable=false islands inside contenteditable=true parents", () => {
    const parent = makeElement({
      tagName: "DIV",
      isContentEditable: true,
      attrs: { contenteditable: "true" },
    });
    const child = makeElement({
      tagName: "SPAN",
      isContentEditable: false,
      attrs: { contenteditable: "false" },
      parentElement: parent,
    });

    assert.equal(
      core.isEventFromEditable(
        { target: child, composedPath: () => [child, parent] },
        {}
      ),
      false
    );
  });
});

describe("findScrollTarget and computeTargetScrollTop", () => {
  it("picks document scrollingElement on standard pages", () => {
    const se = makeElement({
      tagName: "HTML",
      clientHeight: 800,
      scrollHeight: 3200,
      scrollTop: 400,
    });
    const body = makeElement({ tagName: "BODY", parentElement: se });
    const p = makeElement({ tagName: "P", parentElement: body });
    const doc = {
      scrollingElement: se,
      documentElement: se,
      body,
      querySelectorAll: () => [],
    };
    const win = {
      innerWidth: 1280,
      innerHeight: 800,
      getComputedStyle: () => ({ overflowY: "visible", display: "block", visibility: "visible" }),
    };

    const target = core.findScrollTarget(doc, win, p, "halfDown");
    assert.equal(target, se);
    assert.equal(
      core.computeTargetScrollTop("halfDown", { currentTop: 400, clientHeight: 800, scrollHeight: 3200 }, 0.5),
      800
    );
    assert.equal(
      core.computeTargetScrollTop("halfUp", { currentTop: 400, clientHeight: 800, scrollHeight: 3200 }, 0.5),
      0
    );
    assert.equal(
      core.computeTargetScrollTop("bottom", { currentTop: 400, clientHeight: 800, scrollHeight: 3200 }, 0.5),
      2400
    );
    assert.equal(
      core.computeTargetScrollTop("top", { currentTop: 2400, clientHeight: 800, scrollHeight: 3200 }, 0.5),
      0
    );
  });

  it("falls back to largest visible scroll container in SPAs with overflow:hidden document", () => {
    const se = makeElement({
      tagName: "HTML",
      clientHeight: 800,
      scrollHeight: 800,
    });
    const body = makeElement({ tagName: "BODY", parentElement: se });
    const sidebar = makeElement({
      tagName: "ASIDE",
      clientWidth: 240,
      clientHeight: 800,
      scrollHeight: 1800,
      scrollTop: 0,
      parentElement: body,
    });
    const mainPane = makeElement({
      tagName: "MAIN",
      clientWidth: 1000,
      clientHeight: 800,
      scrollHeight: 4000,
      scrollTop: 0,
      parentElement: body,
    });

    const styles = new Map([
      [se, { overflowY: "hidden", display: "block", visibility: "visible" }],
      [body, { overflowY: "hidden", display: "block", visibility: "visible" }],
      [sidebar, { overflowY: "auto", display: "block", visibility: "visible" }],
      [mainPane, { overflowY: "auto", display: "block", visibility: "visible" }],
    ]);

    const doc = {
      scrollingElement: se,
      documentElement: se,
      body,
      querySelectorAll: () => [sidebar, mainPane],
    };
    const win = {
      innerWidth: 1280,
      innerHeight: 800,
      getComputedStyle: (el) => styles.get(el),
    };

    // Without click hint, chooses largest scrollable pane even if it is already at the top
    sidebar.scrollTop = 300;
    assert.equal(core.findScrollTarget(doc, win, body, "halfDown"), mainPane);
    assert.equal(core.findScrollTarget(doc, win, body, "top"), mainPane);

    // With click hint inside sidebar, scrolls sidebar
    const sidebarItem = makeElement({ tagName: "A", parentElement: sidebar });
    assert.equal(core.findScrollTarget(doc, win, sidebarItem, "halfDown"), sidebar);
  });

  it("bubbles up from a nested container already at boundary to document scroll", () => {
    const se = makeElement({
      tagName: "HTML",
      clientHeight: 800,
      scrollHeight: 3000,
      scrollTop: 200,
    });
    const body = makeElement({ tagName: "BODY", parentElement: se });
    const codeBlock = makeElement({
      tagName: "PRE",
      clientWidth: 600,
      clientHeight: 200,
      scrollHeight: 400,
      scrollTop: 200, // Already at bottom of codeBlock
      parentElement: body,
    });
    const span = makeElement({ tagName: "SPAN", parentElement: codeBlock });

    const doc = {
      scrollingElement: se,
      documentElement: se,
      body,
      querySelectorAll: () => [],
    };
    const win = {
      innerWidth: 1280,
      innerHeight: 800,
      getComputedStyle: (el) => ({
        overflowY: el === codeBlock ? "auto" : "visible",
        display: "block",
        visibility: "visible",
      }),
    };

    // Scrolling down at codeBlock's bottom continues to document
    assert.equal(core.findScrollTarget(doc, win, span, "halfDown"), se);
    // Scrolling up inside codeBlock scrolls codeBlock
    assert.equal(core.findScrollTarget(doc, win, span, "halfUp"), codeBlock);

    // Reversing while an animation is still pending uses the pending destination
    codeBlock.scrollTop = 0;
    assert.equal(
      core.findScrollTarget(doc, win, span, "halfUp", {
        target: codeBlock,
        targetTop: 100,
      }),
      codeBlock
    );
  });

  it("scrolls document.body when html disables overflow propagation (overflow:hidden or overflow-x:hidden)", () => {
    for (const htmlStyle of [
      { overflowX: "hidden", overflowY: "hidden", display: "block", visibility: "visible" },
      { overflowX: "hidden", overflowY: "visible", display: "block", visibility: "visible" },
    ]) {
      const se = makeElement({
        tagName: "HTML",
        clientWidth: 1280,
        clientHeight: 800,
        scrollHeight: 800,
      });
      const body = makeElement({
        tagName: "BODY",
        clientWidth: 1280,
        clientHeight: 800,
        scrollHeight: 3200,
        scrollTop: 0,
        parentElement: se,
      });
      const article = makeElement({ tagName: "ARTICLE", parentElement: body });
      const doc = {
        scrollingElement: se,
        documentElement: se,
        body,
        querySelectorAll: () => [body, article],
      };
      const win = {
        innerWidth: 1280,
        innerHeight: 800,
        getComputedStyle: (el) =>
          el === se
            ? htmlStyle
            : el === body
              ? { overflowX: "visible", overflowY: "auto", display: "block", visibility: "visible" }
              : { overflowX: "visible", overflowY: "visible", display: "block", visibility: "visible" },
      };

      assert.equal(core.findScrollTarget(doc, win, article, "halfDown"), body);
      assert.equal(core.findScrollTarget(doc, win, body, "halfDown"), body);
      assert.equal(core.findScrollTarget(doc, win, null, "halfDown"), body);
    }
  });
});

describe("settings and host matching", () => {
  it("normalizes partial/invalid settings safely", () => {
    const normalized = core.normalizeSettings({
      enabled: "yes",
      smoothScroll: false,
      scrollRatio: 5,
      ggTimeoutMs: 10,
      disabledHosts: [" GitHub.com ", "github.com", "", "docs.google.com."],
    });
    assert.deepEqual(normalized, {
      enabled: true,
      smoothScroll: false,
      scrollRatio: core.MAX_SCROLL_RATIO,
      ggTimeoutMs: core.MIN_GG_TIMEOUT_MS,
      disabledHosts: ["github.com", "docs.google.com"],
    });
  });

  it("extracts http/https hosts and ignores browser-internal and Chrome Web Store URLs", () => {
    assert.equal(core.extractHostFromUrl("https://GitHub.com/user/scrollim"), "github.com");
    assert.equal(core.extractHostFromUrl("http://localhost:3000/docs"), "localhost");
    assert.equal(core.extractHostFromUrl("chrome://extensions"), null);
    assert.equal(core.extractHostFromUrl("chrome-extension://abc/popup.html"), null);
    assert.equal(core.extractHostFromUrl("about:blank"), null);
    assert.equal(core.extractHostFromUrl("https://chromewebstore.google.com/detail/scrollim/abc"), null);
    assert.equal(core.extractHostFromUrl("https://chrome.google.com/webstore/detail/scrollim/abc"), null);
  });

  it("matches exact normalized disabled hosts", () => {
    assert.equal(core.isHostDisabled("docs.google.com", ["docs.google.com"]), true);
    assert.equal(core.isHostDisabled("Docs.Google.com.", [" docs.google.com "]), true);
    assert.equal(core.isHostDisabled("google.com", ["docs.google.com"]), false);
    assert.equal(core.isHostDisabled("sub.docs.google.com", ["docs.google.com"]), false);
  });

  it("resolves top-level page host across cross-origin iframes via ancestorOrigins", () => {
    const topWin = {
      location: { hostname: "docs.example.com", ancestorOrigins: [] },
    };
    topWin.top = topWin;
    assert.equal(core.resolvePageHost(topWin), "docs.example.com");

    const crossOriginFrame = {
      location: {
        hostname: "embed.other.test",
        ancestorOrigins: ["https://middle.test", "https://docs.example.com:8443"],
      },
      top: {
        get location() {
          throw new Error("SecurityError");
        },
      },
    };
    assert.equal(core.resolvePageHost(crossOriginFrame), "docs.example.com");
  });
});

describe("manifest integrity", () => {
  it("has valid MV3 manifest, matching package version, and all referenced files exist", () => {
    const rootDir = path.resolve(__dirname, "..");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8")
    );
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
    );
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, "Scrollim");
    assert.equal(manifest.version, pkg.version);
    assert.deepEqual(manifest.permissions, ["storage", "activeTab"]);

    const referencedPaths = [
      manifest.action.default_popup,
      ...Object.values(manifest.icons),
      ...Object.values(manifest.action.default_icon),
      ...manifest.content_scripts.flatMap((cs) => cs.js),
    ];

    for (const relPath of referencedPaths) {
      assert.equal(
        fs.existsSync(path.join(rootDir, relPath)),
        true,
        `Expected ${relPath} to exist`
      );
    }
  });
});
