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
const popupHtmlSource = fs.readFileSync(
  path.resolve(__dirname, "../popup/popup.html"),
  "utf8"
);
const popupJsSource = fs.readFileSync(
  path.resolve(__dirname, "../popup/popup.js"),
  "utf8"
);

function makeControl(id, initial = {}) {
  const listeners = new Map();
  return {
    id,
    checked: false,
    disabled: true,
    hidden: false,
    value: "",
    textContent: "",
    className: "",
    title: "",
    children: [],
    classList: {
      toggles: {},
      toggle(name, force) {
        this.toggles[name] = Boolean(force);
      },
    },
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    trigger(type) {
      for (const fn of listeners.get(type) || []) fn();
    },
    ...initial,
  };
}

function createPopupHarness({ tabUrl = "https://github.com/user/scrollim" } = {}) {
  const elements = {
    "version-badge": makeControl("version-badge"),
    "global-enabled": makeControl("global-enabled", { checked: true, disabled: true }),
    "site-status-dot": makeControl("site-status-dot"),
    "site-host": makeControl("site-host"),
    "site-status-label": makeControl("site-status-label"),
    "site-toggle-btn": makeControl("site-toggle-btn", { disabled: true }),
    "smooth-scroll": makeControl("smooth-scroll", { checked: true, disabled: true }),
    "scroll-ratio": makeControl("scroll-ratio", { value: "50", disabled: true }),
    "scroll-ratio-value": makeControl("scroll-ratio-value"),
    "disabled-hosts-card": makeControl("disabled-hosts-card", { hidden: true }),
    "disabled-hosts-list": makeControl("disabled-hosts-list"),
  };
  const container = makeControl("container");

  let storedState = {
    enabled: true,
    smoothScroll: true,
    scrollRatio: 0.5,
    disabledHosts: ["docs.google.com"],
  };
  const getQueue = [];
  const setCalls = [];
  let tabCallback = null;

  const chromeMock = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "0.1.0" }),
    },
    storage: {
      sync: {
        get(_defaults, cb) {
          getQueue.push(cb);
        },
        set(patch, cb) {
          setCalls.push({ patch, cb });
        },
      },
    },
    tabs: {
      query(_query, cb) {
        tabCallback = cb;
      },
    },
  };

  const documentMock = {
    querySelector: (sel) => (sel === ".container" ? container : null),
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => makeControl(tag),
  };

  const sandbox = {
    document: documentMock,
    chrome: chromeMock,
    URL,
    Promise,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(coreSource, sandbox);
  vm.runInNewContext(popupJsSource, sandbox);

  async function flushMicrotasks() {
    await new Promise((r) => setImmediate(r));
  }

  return {
    elements,
    setCalls,
    get storedState() {
      return storedState;
    },
    set storedState(val) {
      storedState = val;
    },
    async resolveInit() {
      const getCb = getQueue.shift();
      assert.ok(getCb);
      getCb({ ...storedState });
      if (tabCallback) {
        const cb = tabCallback;
        tabCallback = null;
        cb(tabUrl ? [{ url: tabUrl }] : []);
      }
      await flushMicrotasks();
    },
    async resolveSet({ error = null, reloadError = null } = {}) {
      const call = setCalls.shift();
      assert.ok(call);
      if (!error) {
        storedState = { ...storedState, ...call.patch };
      }
      chromeMock.runtime.lastError = error;
      if (call.cb) call.cb();
      chromeMock.runtime.lastError = null;
      if (getQueue.length > 0) {
        const reloadCb = getQueue.shift();
        chromeMock.runtime.lastError = reloadError;
        reloadCb(reloadError ? undefined : { ...storedState });
        chromeMock.runtime.lastError = null;
      }
      await flushMicrotasks();
      return call.patch;
    },
  };
}

describe("popup", () => {
  it("gives the global toggle an accessible label and starts controls disabled", () => {
    assert.match(popupHtmlSource, /id="global-enabled"[\s\S]*?aria-label="[^"]+"/);
    assert.match(popupHtmlSource, /id="global-enabled"[\s\S]*?disabled/);
  });

  it("ignores clicks before init finishes, writes minimal patches, and rolls back on storage error", async () => {
    const h = createPopupHarness();

    // Early toggle before storage loads must not write defaults or wipe disabledHosts
    h.elements["global-enabled"].checked = false;
    h.elements["global-enabled"].trigger("change");
    assert.equal(h.setCalls.length, 0);

    await h.resolveInit();
    assert.equal(h.elements["global-enabled"].disabled, false);
    assert.equal(h.elements["global-enabled"].checked, true);
    assert.equal(h.elements["site-host"].textContent, "github.com");

    // Pausing current site writes only disabledHosts patch
    h.elements["site-toggle-btn"].trigger("click");
    const patch = await h.resolveSet();
    assert.deepEqual(JSON.parse(JSON.stringify(patch)), {
      disabledHosts: ["docs.google.com", "github.com"],
    });

    // On storage quota/write error, popup reloads and restores persisted state
    h.elements["global-enabled"].checked = false;
    h.elements["global-enabled"].trigger("change");
    assert.equal(h.elements["global-enabled"].checked, false);
    await h.resolveSet({ error: { message: "QUOTA_BYTES_PER_ITEM quota exceeded" } });
    assert.equal(h.elements["global-enabled"].checked, true);

    // If reload read also fails after a write error, popup keeps previous settings (not defaults)
    h.elements["smooth-scroll"].checked = false;
    h.elements["smooth-scroll"].trigger("change");
    await h.resolveSet({
      error: { message: "write failed" },
      reloadError: { message: "read failed" },
    });
    assert.equal(h.elements["smooth-scroll"].checked, true);
    assert.equal(h.elements["disabled-hosts-card"].hidden, false);
  });

  it("marks Chrome Web Store tabs as unavailable", async () => {
    const h = createPopupHarness({
      tabUrl: "https://chromewebstore.google.com/detail/scrollim/abc",
    });
    await h.resolveInit();
    assert.equal(h.elements["site-toggle-btn"].disabled, true);
    assert.equal(h.elements["site-status-label"].textContent, "Unavailable on this page");
  });
});
