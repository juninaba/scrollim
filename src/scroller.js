(function (globalScope) {
  "use strict";

  const HALF_PAGE_DURATION_MS = 150;
  const EDGE_JUMP_DURATION_MS = 220;

  function easeOutCubic(t) {
    const inv = 1 - t;
    return 1 - inv * inv * inv;
  }

  function applyInstantScroll(target, top) {
    if (!target) {
      return;
    }
    if (typeof target.scrollTo === "function") {
      try {
        target.scrollTo({ top, behavior: "instant" });
        return;
      } catch {
        // Fall back to direct scrollTop assignment if options object is unsupported.
      }
    }
    target.scrollTop = top;
  }

  function prefersReducedMotion(win) {
    if (!win || typeof win.matchMedia !== "function") {
      return false;
    }
    try {
      return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  function createScroller(win, core) {
    let active = null;

    function cancel() {
      if (active && active.rafId !== null && typeof win.cancelAnimationFrame === "function") {
        win.cancelAnimationFrame(active.rafId);
      }
      active = null;
    }

    function getViewportHeight(target) {
      const se = core.getDocumentScrollingElement(win.document);
      if (target === se) {
        return target.clientHeight || win.innerHeight || 0;
      }
      return Math.min(target.clientHeight || 0, win.innerHeight || target.clientHeight || 0);
    }

    function scroll(target, action, settings) {
      if (!target || !action) {
        return;
      }

      const clientHeight = target.clientHeight || win.innerHeight || 0;
      const effectiveStepHeight = getViewportHeight(target) || clientHeight;
      const scrollHeight = target.scrollHeight || clientHeight;
      const maxTop = Math.max(0, scrollHeight - clientHeight);

      const useSmooth =
        Boolean(settings.smoothScroll) &&
        !prefersReducedMotion(win) &&
        typeof win.requestAnimationFrame === "function";

      const isSameTarget = active && active.target === target;
      const baseTop = isSameTarget ? active.targetTop : target.scrollTop;

      const nextTop = core.computeTargetScrollTop(
        action,
        {
          currentTop: baseTop,
          clientHeight,
          stepHeight: effectiveStepHeight,
          scrollHeight,
        },
        settings.scrollRatio
      );

      if (!useSmooth) {
        cancel();
        applyInstantScroll(target, nextTop);
        return;
      }

      if (isSameTarget && Math.abs(nextTop - active.targetTop) < 0.5) {
        return;
      }

      const startTop = target.scrollTop;
      if (Math.abs(nextTop - startTop) < 0.5) {
        cancel();
        applyInstantScroll(target, Math.min(maxTop, Math.max(0, nextTop)));
        return;
      }

      const duration =
        action === "top" || action === "bottom"
          ? EDGE_JUMP_DURATION_MS
          : HALF_PAGE_DURATION_MS;

      cancel();

      const now =
        win.performance && typeof win.performance.now === "function"
          ? win.performance.now()
          : Date.now();

      const anim = {
        target,
        startTop,
        targetTop: nextTop,
        startTime: now,
        duration,
        rafId: null,
      };
      active = anim;

      function step(timestamp) {
        if (active !== anim) {
          return;
        }
        const elapsed = Math.max(0, timestamp - anim.startTime);
        const progress = Math.min(1, elapsed / anim.duration);
        const eased = easeOutCubic(progress);
        const current = anim.startTop + (anim.targetTop - anim.startTop) * eased;

        applyInstantScroll(anim.target, current);

        if (progress < 1) {
          anim.rafId = win.requestAnimationFrame(step);
        } else {
          applyInstantScroll(anim.target, anim.targetTop);
          active = null;
        }
      }

      anim.rafId = win.requestAnimationFrame(step);
    }

    return {
      scroll,
      cancel,
      isAnimating() {
        return active !== null;
      },
      getPendingTarget() {
        return active
          ? { target: active.target, targetTop: active.targetTop }
          : null;
      },
    };
  }

  const api = {
    HALF_PAGE_DURATION_MS,
    EDGE_JUMP_DURATION_MS,
    easeOutCubic,
    applyInstantScroll,
    createScroller,
  };

  globalScope.ScrollimScroller = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
