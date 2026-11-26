(function () {
  "use strict";

  const core = globalThis.ScrollimCore;
  const scrollerApi = globalThis.ScrollimScroller;

  if (!core || !scrollerApi) {
    return;
  }

  // Guard against double initialization if script is injected more than once.
  if (globalThis.__scrollimInitialized) {
    return;
  }
  globalThis.__scrollimInitialized = true;

  const hasChromeStorage =
    typeof chrome !== "undefined" &&
    Boolean(chrome.storage) &&
    Boolean(chrome.storage.sync);

  let settings = core.normalizeSettings(core.DEFAULT_SETTINGS);
  let settingsReady = !hasChromeStorage;
  let retriedLoad = false;
  let keyState = core.createKeyState();
  let lastInteractedElement = null;
  const scroller = scrollerApi.createScroller(window, core);

  function isActiveOnCurrentPage() {
    if (!settingsReady || !settings.enabled) {
      return false;
    }
    const host = core.resolvePageHost(window);
    if (host && core.isHostDisabled(host, settings.disabledHosts)) {
      return false;
    }
    return true;
  }

  function resetKeyState() {
    keyState = core.createKeyState();
  }

  function loadSettings() {
    if (!hasChromeStorage) {
      return;
    }
    chrome.storage.sync.get(core.DEFAULT_SETTINGS, (stored) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        if (!retriedLoad && typeof setTimeout === "function") {
          retriedLoad = true;
          setTimeout(loadSettings, 500);
        }
        return;
      }
      settings = core.normalizeSettings(stored);
      settingsReady = true;
      if (!isActiveOnCurrentPage()) {
        resetKeyState();
        scroller.cancel();
      }
    });
  }

  if (hasChromeStorage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }
      if (!settingsReady) {
        loadSettings();
        return;
      }
      const next = { ...settings };
      for (const [key, change] of Object.entries(changes)) {
        next[key] = change.newValue;
      }
      settings = core.normalizeSettings(next);
      if (!isActiveOnCurrentPage()) {
        resetKeyState();
        scroller.cancel();
      }
    });
  }

  loadSettings();

  function getHintElement() {
    const activeEl = core.getDeepActiveElement(document);
    if (
      activeEl &&
      activeEl !== document.body &&
      activeEl !== document.documentElement &&
      activeEl.isConnected
    ) {
      return activeEl;
    }
    if (lastInteractedElement && lastInteractedElement.isConnected) {
      return lastInteractedElement;
    }
    return activeEl;
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.isTrusted === false) {
        return;
      }

      if (!isActiveOnCurrentPage()) {
        resetKeyState();
        return;
      }

      if (core.isEventFromEditable(event, document)) {
        resetKeyState();
        return;
      }

      const result = core.resolveKeyAction(
        event,
        keyState,
        Date.now(),
        settings.ggTimeoutMs
      );
      keyState = result.nextState;

      if (result.preventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (!result.action) {
        if (!result.isModifier && !result.preventDefault && !event.repeat) {
          scroller.cancel();
        }
        return;
      }

      const target = core.findScrollTarget(
        document,
        window,
        getHintElement(),
        result.action,
        scroller.getPendingTarget()
      );
      if (target) {
        scroller.scroll(target, result.action, settings);
      }
    },
    true
  );

  window.addEventListener(
    "pointerdown",
    (event) => {
      resetKeyState();
      scroller.cancel();
      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const firstEl = path.find((node) => node && node.nodeType === 1);
      lastInteractedElement = firstEl || (event.target && event.target.nodeType === 1 ? event.target : null);
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "wheel",
    () => {
      scroller.cancel();
    },
    { capture: true, passive: true }
  );

  window.addEventListener(
    "touchstart",
    () => {
      scroller.cancel();
    },
    { capture: true, passive: true }
  );

  window.addEventListener("blur", () => {
    resetKeyState();
    scroller.cancel();
  });

  document.addEventListener("focusin", () => {
    resetKeyState();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      resetKeyState();
      scroller.cancel();
    }
  });
})();
