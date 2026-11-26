(function () {
  "use strict";

  const core = globalThis.ScrollimCore;
  if (!core) {
    return;
  }

  const containerEl = document.querySelector(".container");
  const versionBadgeEl = document.getElementById("version-badge");
  const globalEnabledEl = document.getElementById("global-enabled");
  const siteStatusDotEl = document.getElementById("site-status-dot");
  const siteHostEl = document.getElementById("site-host");
  const siteStatusLabelEl = document.getElementById("site-status-label");
  const siteToggleBtnEl = document.getElementById("site-toggle-btn");
  const smoothScrollEl = document.getElementById("smooth-scroll");
  const scrollRatioEl = document.getElementById("scroll-ratio");
  const scrollRatioValueEl = document.getElementById("scroll-ratio-value");
  const disabledHostsCardEl = document.getElementById("disabled-hosts-card");
  const disabledHostsListEl = document.getElementById("disabled-hosts-list");

  let settings = core.normalizeSettings(core.DEFAULT_SETTINGS);
  let currentHost = null;
  let initialized = false;

  const hasChromeRuntime =
    typeof chrome !== "undefined" && Boolean(chrome.runtime);
  const hasChromeStorage =
    typeof chrome !== "undefined" &&
    Boolean(chrome.storage) &&
    Boolean(chrome.storage.sync);
  const hasChromeTabs =
    typeof chrome !== "undefined" &&
    Boolean(chrome.tabs) &&
    typeof chrome.tabs.query === "function";

  if (hasChromeRuntime && typeof chrome.runtime.getManifest === "function") {
    const manifest = chrome.runtime.getManifest();
    if (manifest && manifest.version) {
      versionBadgeEl.textContent = "v" + manifest.version;
    }
  }

  function readStoredSettings(fallback = core.DEFAULT_SETTINGS) {
    return new Promise((resolve) => {
      if (!hasChromeStorage) {
        resolve(fallback);
        return;
      }
      chrome.storage.sync.get(core.DEFAULT_SETTINGS, (stored) => {
        if (hasChromeRuntime && chrome.runtime.lastError) {
          resolve(fallback);
          return;
        }
        resolve(stored);
      });
    });
  }

  function reloadSettings(fallback = settings) {
    readStoredSettings(fallback).then((stored) => {
      settings = core.normalizeSettings(stored);
      render();
    });
  }

  function saveSettings(partial) {
    if (!initialized) {
      return;
    }
    const previous = settings;
    const next = core.normalizeSettings({ ...settings, ...partial });
    const patch = {};
    for (const key of Object.keys(partial)) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        patch[key] = next[key];
      }
    }
    settings = next;
    render();
    if (hasChromeStorage) {
      chrome.storage.sync.set(patch, () => {
        if (hasChromeRuntime && chrome.runtime.lastError) {
          reloadSettings(previous);
        }
      });
    }
  }

  function renderSiteSection() {
    if (!currentHost) {
      siteHostEl.textContent = "Browser page";
      siteStatusLabelEl.textContent = "Unavailable on this page";
      siteStatusDotEl.className = "status-dot";
      siteToggleBtnEl.textContent = "Pause";
      siteToggleBtnEl.disabled = true;
      return;
    }

    siteHostEl.textContent = currentHost;
    siteToggleBtnEl.disabled = false;

    const hostDisabled = core.isHostDisabled(currentHost, settings.disabledHosts);
    if (!settings.enabled) {
      siteStatusLabelEl.textContent = "Paused globally";
      siteStatusDotEl.className = "status-dot status-dot--paused";
      siteToggleBtnEl.textContent = hostDisabled ? "Resume" : "Pause";
    } else if (hostDisabled) {
      siteStatusLabelEl.textContent = "Paused on this site";
      siteStatusDotEl.className = "status-dot status-dot--paused";
      siteToggleBtnEl.textContent = "Resume";
    } else {
      siteStatusLabelEl.textContent = "Active on this site";
      siteStatusDotEl.className = "status-dot status-dot--active";
      siteToggleBtnEl.textContent = "Pause";
    }
  }

  function renderDisabledHosts() {
    const hosts = settings.disabledHosts;
    if (!hosts.length) {
      disabledHostsCardEl.hidden = true;
      disabledHostsListEl.textContent = "";
      return;
    }

    disabledHostsCardEl.hidden = false;
    disabledHostsListEl.textContent = "";

    for (const host of hosts) {
      const li = document.createElement("li");
      li.className = "host-item";

      const span = document.createElement("span");
      span.className = "host-item-name";
      span.textContent = host;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "host-remove-btn";
      btn.textContent = "×";
      btn.title = "Re-enable on " + host;
      btn.setAttribute("aria-label", "Re-enable on " + host);
      btn.addEventListener("click", () => {
        const nextHosts = settings.disabledHosts.filter((item) => item !== host);
        saveSettings({ disabledHosts: nextHosts });
      });

      li.appendChild(span);
      li.appendChild(btn);
      disabledHostsListEl.appendChild(li);
    }
  }

  function render() {
    globalEnabledEl.checked = settings.enabled;
    smoothScrollEl.checked = settings.smoothScroll;

    const percent = Math.round(settings.scrollRatio * 100);
    scrollRatioEl.value = String(percent);
    scrollRatioValueEl.textContent = percent + "%";

    containerEl.classList.toggle("is-disabled", !settings.enabled);
    renderSiteSection();
    renderDisabledHosts();
  }

  globalEnabledEl.addEventListener("change", () => {
    saveSettings({ enabled: globalEnabledEl.checked });
  });

  smoothScrollEl.addEventListener("change", () => {
    saveSettings({ smoothScroll: smoothScrollEl.checked });
  });

  scrollRatioEl.addEventListener("input", () => {
    if (!initialized) {
      return;
    }
    const percent = Number(scrollRatioEl.value);
    scrollRatioValueEl.textContent = percent + "%";
  });

  scrollRatioEl.addEventListener("change", () => {
    const percent = Number(scrollRatioEl.value);
    saveSettings({ scrollRatio: percent / 100 });
  });

  siteToggleBtnEl.addEventListener("click", () => {
    if (!initialized || !currentHost) {
      return;
    }
    const isDisabled = core.isHostDisabled(currentHost, settings.disabledHosts);
    const nextHosts = isDisabled
      ? settings.disabledHosts.filter((item) => item !== currentHost)
      : [...settings.disabledHosts, currentHost];
    saveSettings({ disabledHosts: nextHosts });
  });

  function init() {
    const settingsPromise = readStoredSettings();

    const tabPromise = new Promise((resolve) => {
      if (!hasChromeTabs) {
        resolve(null);
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (hasChromeRuntime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        const activeTab = Array.isArray(tabs) ? tabs[0] : null;
        resolve(activeTab && activeTab.url ? core.extractHostFromUrl(activeTab.url) : null);
      });
    });

    Promise.all([settingsPromise, tabPromise]).then(([storedSettings, host]) => {
      settings = core.normalizeSettings(storedSettings);
      currentHost = host;
      initialized = true;
      globalEnabledEl.disabled = false;
      smoothScrollEl.disabled = false;
      scrollRatioEl.disabled = false;
      render();
    });
  }

  init();
})();
