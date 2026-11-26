(function (globalScope) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    smoothScroll: true,
    scrollRatio: 0.5,
    ggTimeoutMs: 500,
    disabledHosts: [],
  });

  const MIN_SCROLL_RATIO = 0.25;
  const MAX_SCROLL_RATIO = 0.8;
  const MIN_GG_TIMEOUT_MS = 150;
  const MAX_GG_TIMEOUT_MS = 2000;

  const MODIFIER_KEYS = new Set([
    "Shift",
    "Control",
    "Alt",
    "Meta",
    "CapsLock",
    "AltGraph",
    "OS",
    "NumLock",
    "ScrollLock",
  ]);

  const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "submit",
    "reset",
    "checkbox",
    "radio",
    "file",
    "image",
    "hidden",
  ]);

  const EDITABLE_ROLES = new Set(["textbox", "searchbox", "spinbutton", "combobox"]);
  const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);
  const SCROLL_EPSILON = 1;

  function clampNumber(value, min, max, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, value));
  }

  function normalizeHost(host) {
    if (typeof host !== "string") {
      return "";
    }
    return host.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  }

  function normalizeSettings(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    const seenHosts = new Set();
    const disabledHosts = [];

    if (Array.isArray(input.disabledHosts)) {
      for (const entry of input.disabledHosts) {
        const normalized = normalizeHost(entry);
        if (normalized && !seenHosts.has(normalized)) {
          seenHosts.add(normalized);
          disabledHosts.push(normalized);
        }
      }
    }

    return {
      enabled:
        typeof input.enabled === "boolean"
          ? input.enabled
          : DEFAULT_SETTINGS.enabled,
      smoothScroll:
        typeof input.smoothScroll === "boolean"
          ? input.smoothScroll
          : DEFAULT_SETTINGS.smoothScroll,
      scrollRatio: Math.round(
        clampNumber(
          input.scrollRatio,
          MIN_SCROLL_RATIO,
          MAX_SCROLL_RATIO,
          DEFAULT_SETTINGS.scrollRatio
        ) * 100
      ) / 100,
      ggTimeoutMs: Math.round(
        clampNumber(
          input.ggTimeoutMs,
          MIN_GG_TIMEOUT_MS,
          MAX_GG_TIMEOUT_MS,
          DEFAULT_SETTINGS.ggTimeoutMs
        )
      ),
      disabledHosts,
    };
  }

  function extractHostFromUrl(urlString) {
    if (typeof urlString !== "string" || !urlString) {
      return null;
    }
    try {
      const parsed = new URL(urlString);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      const host = normalizeHost(parsed.hostname);
      if (!host) {
        return null;
      }
      if (
        host === "chromewebstore.google.com" ||
        (host === "chrome.google.com" && parsed.pathname.startsWith("/webstore"))
      ) {
        return null;
      }
      return host;
    } catch {
      return null;
    }
  }

  function isHostDisabled(host, disabledHosts) {
    const normalizedHost = normalizeHost(host);
    if (!normalizedHost || !Array.isArray(disabledHosts)) {
      return false;
    }
    return disabledHosts.some((entry) => normalizeHost(entry) === normalizedHost);
  }

  function resolvePageHost(win) {
    if (!win) {
      return "";
    }
    try {
      const origins = win.location && win.location.ancestorOrigins;
      if (origins && origins.length > 0) {
        const topHost = extractHostFromUrl(origins[origins.length - 1]);
        if (topHost) {
          return topHost;
        }
      }
    } catch {
      // Ignore restricted location access.
    }
    try {
      if (win !== win.top && win.top && win.top.location) {
        const topHost = normalizeHost(win.top.location.hostname);
        if (topHost) {
          return topHost;
        }
      }
    } catch {
      // Cross-origin frame without ancestorOrigins.
    }
    try {
      return normalizeHost(win.location && win.location.hostname);
    } catch {
      return "";
    }
  }

  function getAttrLower(el, name) {
    if (!el || typeof el.getAttribute !== "function") {
      return null;
    }
    const value = el.getAttribute(name);
    return typeof value === "string" ? value.toLowerCase() : null;
  }

  function isEditableElement(el) {
    if (!el || el.nodeType !== 1) {
      return false;
    }

    if (el.isContentEditable === true) {
      return true;
    }

    const contentEditableAttr = getAttrLower(el, "contenteditable");
    if (
      contentEditableAttr === "" ||
      contentEditableAttr === "true" ||
      contentEditableAttr === "plaintext-only"
    ) {
      return true;
    }

    const tagName = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
    if (tagName === "TEXTAREA" || tagName === "SELECT") {
      return true;
    }

    if (tagName === "INPUT") {
      const rawType =
        (typeof el.type === "string" && el.type) ||
        getAttrLower(el, "type") ||
        "text";
      return !NON_TEXT_INPUT_TYPES.has(rawType.toLowerCase());
    }

    const role = getAttrLower(el, "role");
    if (role && EDITABLE_ROLES.has(role)) {
      return true;
    }

    return false;
  }

  function getShadowRoot(el) {
    if (!el) {
      return null;
    }
    if (el.shadowRoot) {
      return el.shadowRoot;
    }
    if (
      typeof chrome !== "undefined" &&
      chrome.dom &&
      typeof chrome.dom.openOrClosedShadowRoot === "function"
    ) {
      try {
        return chrome.dom.openOrClosedShadowRoot(el);
      } catch {
        return null;
      }
    }
    return null;
  }

  function getDeepActiveElement(doc) {
    if (!doc) {
      return null;
    }
    let current = doc.activeElement || null;
    let depth = 0;
    while (current && depth < 16) {
      const root = getShadowRoot(current);
      if (!root || !root.activeElement) {
        break;
      }
      current = root.activeElement;
      depth += 1;
    }
    return current;
  }

  function hasEditableContentAncestor(el) {
    let current = el;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 32) {
      if (current.isContentEditable === true) {
        return true;
      }
      const attr = getAttrLower(current, "contenteditable");
      if (attr === "false") {
        return false;
      }
      if (attr === "" || attr === "true" || attr === "plaintext-only") {
        return true;
      }
      if (current.isContentEditable === false && attr === null) {
        // Real browser DOM already computes isContentEditable across ancestors.
        // Only fall through if isContentEditable is undefined (e.g. lightweight mocks).
        break;
      }
      current = getParentAcrossShadow(current);
      depth += 1;
    }
    return false;
  }

  function isEventFromEditable(event, doc) {
    if (doc && doc.designMode === "on") {
      return true;
    }

    const path =
      event && typeof event.composedPath === "function"
        ? event.composedPath()
        : event && event.target
          ? [event.target]
          : [];

    let checkedInnermostElement = false;
    for (const node of path) {
      if (!node || node.nodeType !== 1) {
        continue;
      }

      if (!checkedInnermostElement) {
        checkedInnermostElement = true;
        if (isEditableElement(node) || hasEditableContentAncestor(node)) {
          return true;
        }
        continue;
      }

      const tagName =
        typeof node.tagName === "string" ? node.tagName.toUpperCase() : "";
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
        if (isEditableElement(node)) {
          return true;
        }
      }
      const role = getAttrLower(node, "role");
      if (role && EDITABLE_ROLES.has(role)) {
        return true;
      }
    }

    const activeElement = getDeepActiveElement(doc);
    if (
      activeElement &&
      (isEditableElement(activeElement) || hasEditableContentAncestor(activeElement))
    ) {
      return true;
    }

    return false;
  }

  function createKeyState() {
    return { lastGTime: 0 };
  }

  function resolveKeyAction(event, state, now, ggTimeoutMs) {
    const currentState = state && typeof state === "object" ? state : createKeyState();
    const timeout = clampNumber(
      ggTimeoutMs,
      MIN_GG_TIMEOUT_MS,
      MAX_GG_TIMEOUT_MS,
      DEFAULT_SETTINGS.ggTimeoutMs
    );

    if (!event || event.isComposing || event.keyCode === 229) {
      return {
        action: null,
        preventDefault: false,
        nextState: { lastGTime: 0 },
      };
    }

    const key = typeof event.key === "string" ? event.key : "";
    if (!key) {
      return {
        action: null,
        preventDefault: false,
        nextState: { lastGTime: 0 },
      };
    }

    if (MODIFIER_KEYS.has(key)) {
      return {
        action: null,
        preventDefault: false,
        isModifier: true,
        nextState: { lastGTime: currentState.lastGTime || 0 },
      };
    }

    const keyLower = key.toLowerCase();
    const isAsciiLetter = /^[a-z]$/i.test(key);
    const code = typeof event.code === "string" ? event.code : "";

    // Ctrl+d: half-page down (fallback to physical KeyD on non-Latin layouts)
    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      (keyLower === "d" || (!isAsciiLetter && code === "KeyD"))
    ) {
      return {
        action: "halfDown",
        preventDefault: true,
        nextState: { lastGTime: 0 },
      };
    }

    // Ctrl+u: half-page up (fallback to physical KeyU on non-Latin layouts)
    if (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      (keyLower === "u" || (!isAsciiLetter && code === "KeyU"))
    ) {
      return {
        action: "halfUp",
        preventDefault: true,
        nextState: { lastGTime: 0 },
      };
    }

    // Shift+G: bottom of page
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.shiftKey &&
      (key === "G" || key === "g")
    ) {
      return {
        action: event.repeat ? null : "bottom",
        preventDefault: true,
        nextState: { lastGTime: 0 },
      };
    }

    // gg: top of page
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      key === "g"
    ) {
      if (event.repeat) {
        return {
          action: null,
          preventDefault: false,
          nextState: { lastGTime: 0 },
        };
      }

      const lastGTime = currentState.lastGTime || 0;
      if (lastGTime > 0 && now >= lastGTime && now - lastGTime <= timeout) {
        return {
          action: "top",
          preventDefault: true,
          nextState: { lastGTime: 0 },
        };
      }

      return {
        action: null,
        preventDefault: false,
        nextState: { lastGTime: now },
      };
    }

    return {
      action: null,
      preventDefault: false,
      nextState: { lastGTime: 0 },
    };
  }

  function getParentAcrossShadow(node) {
    if (!node) {
      return null;
    }
    if (node.parentElement) {
      return node.parentElement;
    }
    if (typeof node.getRootNode === "function") {
      const root = node.getRootNode();
      if (root && root.host) {
        return root.host;
      }
    }
    return null;
  }

  function getDocumentScrollingElement(doc) {
    if (!doc) {
      return null;
    }
    return doc.scrollingElement || doc.documentElement || doc.body || null;
  }

  function doesHtmlPropagateBodyOverflow(doc, win) {
    if (!doc || !doc.documentElement || !win || typeof win.getComputedStyle !== "function") {
      return true;
    }
    const htmlStyle = win.getComputedStyle(doc.documentElement);
    if (!htmlStyle) {
      return true;
    }
    const overflowY = htmlStyle.overflowY || "visible";
    const overflowX = htmlStyle.overflowX || "visible";
    return overflowY === "visible" && overflowX === "visible";
  }

  function isDocumentScrollable(doc, win) {
    const se = getDocumentScrollingElement(doc);
    if (!se) {
      return false;
    }
    if (se.scrollHeight <= se.clientHeight + SCROLL_EPSILON) {
      return false;
    }
    if (!win || typeof win.getComputedStyle !== "function") {
      return true;
    }
    const effectiveOverflow = doesHtmlPropagateBodyOverflow(doc, win)
      ? (doc.body && win.getComputedStyle(doc.body)?.overflowY) || "visible"
      : (doc.documentElement && win.getComputedStyle(doc.documentElement)?.overflowY) || "visible";
    return effectiveOverflow !== "hidden" && effectiveOverflow !== "clip";
  }

  function isElementScrollable(el, doc, win) {
    if (!el || el.nodeType !== 1) {
      return false;
    }
    const se = getDocumentScrollingElement(doc);
    if (el === se || el === doc.documentElement) {
      return false;
    }
    if (el === doc.body && doesHtmlPropagateBodyOverflow(doc, win)) {
      return false;
    }
    if (el.clientHeight <= 0 || el.scrollHeight <= el.clientHeight + SCROLL_EPSILON) {
      return false;
    }
    if (!win || typeof win.getComputedStyle !== "function") {
      return true;
    }
    const style = win.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return SCROLLABLE_OVERFLOW_VALUES.has(style.overflowY);
  }

  function canScrollInActionDirection(el, action, pendingScroll) {
    if (!el) {
      return false;
    }
    const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxTop <= SCROLL_EPSILON) {
      return false;
    }
    const pendingTop =
      pendingScroll &&
      pendingScroll.target === el &&
      Number.isFinite(pendingScroll.targetTop)
        ? pendingScroll.targetTop
        : el.scrollTop;
    if (action === "top" || action === "halfUp") {
      return el.scrollTop > 0.5 || pendingTop > 0.5;
    }
    if (action === "bottom" || action === "halfDown") {
      return el.scrollTop < maxTop - 0.5 || pendingTop < maxTop - 0.5;
    }
    return true;
  }

  function findLargestScrollableElement(doc, win) {
    if (!doc || typeof doc.querySelectorAll !== "function") {
      return null;
    }

    const viewportWidth = (win && win.innerWidth) || 1280;
    const viewportHeight = (win && win.innerHeight) || 800;
    const candidates = doc.querySelectorAll("*");

    let best = null;
    let bestArea = 0;

    for (let i = 0; i < candidates.length; i += 1) {
      const el = candidates[i];
      if (
        el.clientHeight < 80 ||
        el.clientWidth < 80 ||
        el.scrollHeight <= el.clientHeight + SCROLL_EPSILON
      ) {
        continue;
      }

      if (!isElementScrollable(el, doc, win)) {
        continue;
      }

      let visibleArea = el.clientWidth * el.clientHeight;
      if (typeof el.getBoundingClientRect === "function") {
        const rect = el.getBoundingClientRect();
        const visibleW = Math.max(
          0,
          Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
        );
        const visibleH = Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        visibleArea = visibleW * visibleH;
        if (visibleArea <= 0) {
          continue;
        }
      }

      if (visibleArea > bestArea) {
        best = el;
        bestArea = visibleArea;
      }
    }

    return best;
  }

  function findScrollTarget(doc, win, hintElement, action, pendingScroll) {
    const se = getDocumentScrollingElement(doc);
    const docScrollable = isDocumentScrollable(doc, win);

    // 1. Walk up from the user's focused / last-clicked element to find a scrollable container.
    let current = hintElement && hintElement.isConnected !== false ? hintElement : null;
    let firstScrollableAncestor = null;
    let depth = 0;

    while (current && depth < 64) {
      if (current === se || current === doc.documentElement) {
        break;
      }
      if (isElementScrollable(current, doc, win)) {
        if (!firstScrollableAncestor) {
          firstScrollableAncestor = current;
        }
        if (canScrollInActionDirection(current, action, pendingScroll)) {
          return current;
        }
      }
      current = getParentAcrossShadow(current);
      depth += 1;
    }

    // 2. Fall back to the main document scrolling element when it can scroll.
    if (docScrollable) {
      if (
        !firstScrollableAncestor ||
        canScrollInActionDirection(se, action, pendingScroll)
      ) {
        return se;
      }
      return firstScrollableAncestor;
    }

    if (firstScrollableAncestor) {
      return firstScrollableAncestor;
    }

    // 3. SPA fallback: when the document itself isn't scrollable, find the largest visible scroll container.
    const largest = findLargestScrollableElement(doc, win);
    return largest || se;
  }

  function computeTargetScrollTop(action, metrics, scrollRatio) {
    const currentTop = Number.isFinite(metrics.currentTop) ? metrics.currentTop : 0;
    const clientHeight = Math.max(0, Number.isFinite(metrics.clientHeight) ? metrics.clientHeight : 0);
    const stepHeight =
      Number.isFinite(metrics.stepHeight) && metrics.stepHeight > 0
        ? metrics.stepHeight
        : clientHeight;
    const scrollHeight = Math.max(
      clientHeight,
      Number.isFinite(metrics.scrollHeight) ? metrics.scrollHeight : clientHeight
    );
    const maxTop = Math.max(0, scrollHeight - clientHeight);
    const ratio = clampNumber(
      scrollRatio,
      MIN_SCROLL_RATIO,
      MAX_SCROLL_RATIO,
      DEFAULT_SETTINGS.scrollRatio
    );
    const step = Math.max(1, Math.round(stepHeight * ratio));

    switch (action) {
      case "top":
        return 0;
      case "bottom":
        return maxTop;
      case "halfUp":
        return Math.max(0, currentTop - step);
      case "halfDown":
        return Math.min(maxTop, currentTop + step);
      default:
        return Math.min(maxTop, Math.max(0, currentTop));
    }
  }

  const api = {
    DEFAULT_SETTINGS,
    MIN_SCROLL_RATIO,
    MAX_SCROLL_RATIO,
    MIN_GG_TIMEOUT_MS,
    MAX_GG_TIMEOUT_MS,
    normalizeHost,
    normalizeSettings,
    extractHostFromUrl,
    isHostDisabled,
    resolvePageHost,
    isEditableElement,
    getDeepActiveElement,
    isEventFromEditable,
    createKeyState,
    resolveKeyAction,
    getDocumentScrollingElement,
    isDocumentScrollable,
    isElementScrollable,
    canScrollInActionDirection,
    findScrollTarget,
    computeTargetScrollTop,
  };

  globalScope.ScrollimCore = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
