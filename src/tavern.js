/**
 * tavern.js — Client-side companion for the tavern SSE pub/sub engine.
 *
 * Listens for tavern control events on HTMX SSE connections and translates
 * them into declarative, data-attribute-driven UI behaviors.
 *
 * Control events handled:
 * - tavern-reconnected  — fires when the server confirms a reconnection
 * - tavern-replay-gap   — fires when the replay log cannot satisfy Last-Event-ID
 * - tavern-topics-changed — fires when subscription topics change at runtime
 *
 * @module tavern
 * @version 0.0.2
 * @license MIT
 * @see https://github.com/catgoose/tavern
 */

(function () {
  "use strict";

  /** @type {string} SSE event name for reconnection confirmation */
  const EVT_RECONNECTED = "tavern-reconnected";

  /** @type {string} SSE event name for replay gap detection */
  const EVT_REPLAY_GAP = "tavern-replay-gap";

  /** @type {string} SSE event name for topic subscription changes */
  const EVT_TOPICS_CHANGED = "tavern-topics-changed";

  /**
   * @typedef {Object} TavernConfig
   * @property {string} [reconnectingClass] - CSS class applied during disconnection
   * @property {string} [gapAction] - Action on replay gap: "reload", "banner", or custom event name
   * @property {string} [gapBannerText] - Text for the gap banner (default: "Connection interrupted. Click to refresh.")
   * @property {boolean} [debug] - Enable debug logging
   */

  /**
   * Reads tavern configuration from data attributes on an element.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @returns {TavernConfig} Parsed configuration
   */
  function readConfig(el) {
    return {
      reconnectingClass: el.getAttribute("data-tavern-reconnecting-class"),
      gapAction: el.getAttribute("data-tavern-gap-action"),
      gapBannerText: el.getAttribute("data-tavern-gap-banner-text"),
      debug: el.hasAttribute("data-tavern-debug"),
    };
  }

  /**
   * Logs a debug message if debug mode is enabled.
   *
   * @param {TavernConfig} config - Current configuration
   * @param {string} msg - Message to log
   * @param {...*} args - Additional log arguments
   */
  function debug(config, msg, ...args) {
    if (config.debug) {
      console.debug("[tavern]", msg, ...args);
    }
  }

  /**
   * Shows all [data-tavern-status] children within an element.
   *
   * @param {HTMLElement} el - Parent element to search within
   */
  function showStatus(el) {
    el.querySelectorAll("[data-tavern-status]").forEach(function (s) {
      s.classList.remove("hidden");
      s.removeAttribute("hidden");
    });
  }

  /**
   * Hides all [data-tavern-status] children within an element.
   *
   * @param {HTMLElement} el - Parent element to search within
   */
  function hideStatus(el) {
    el.querySelectorAll("[data-tavern-status]").forEach(function (s) {
      s.classList.add("hidden");
      s.setAttribute("hidden", "");
    });
  }

  /**
   * Marks an element as disconnected: applies reconnecting class and shows
   * status elements.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   */
  function markDisconnected(el, config) {
    if (el._tavernDisconnected) return;
    el._tavernDisconnected = true;

    debug(config, "disconnected", el);

    if (config.reconnectingClass) {
      config.reconnectingClass.split(/\s+/).forEach(function (cls) {
        if (cls) el.classList.add(cls);
      });
    }

    showStatus(el);

    el.dispatchEvent(
      new CustomEvent("tavern:disconnected", { bubbles: true }),
    );
  }

  /**
   * Marks an element as reconnected: removes reconnecting class and hides
   * status elements.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   */
  function markReconnected(el, config) {
    if (!el._tavernDisconnected) return;
    el._tavernDisconnected = false;

    debug(config, "reconnected", el);

    if (config.reconnectingClass) {
      config.reconnectingClass.split(/\s+/).forEach(function (cls) {
        if (cls) el.classList.remove(cls);
      });
    }

    hideStatus(el);

    el.dispatchEvent(
      new CustomEvent("tavern:reconnected", { bubbles: true }),
    );
  }

  /**
   * Handles a replay gap event. Depending on the configured gap action,
   * this may reload the page, show a banner, or dispatch a custom event.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   * @param {string} lastEventId - The Last-Event-ID that could not be replayed
   */
  function handleReplayGap(el, config, lastEventId) {
    debug(config, "replay gap detected, lastEventId:", lastEventId);

    var action = config.gapAction;
    if (!action) {
      el.dispatchEvent(
        new CustomEvent("tavern:replay-gap", {
          bubbles: true,
          detail: { lastEventId: lastEventId },
        }),
      );
      return;
    }

    if (action === "reload") {
      window.location.reload();
      return;
    }

    if (action === "banner") {
      showGapBanner(el, config);
      return;
    }

    // Custom event name — dispatch it
    el.dispatchEvent(
      new CustomEvent(action, {
        bubbles: true,
        detail: { lastEventId: lastEventId },
      }),
    );
  }

  /**
   * Shows a clickable banner within the element indicating missed messages.
   * Clicking the banner reloads the page.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   */
  function showGapBanner(el, config) {
    // Avoid duplicate banners
    if (el.querySelector("[data-tavern-gap-banner]")) return;

    var banner = document.createElement("div");
    banner.setAttribute("data-tavern-gap-banner", "");
    banner.setAttribute("role", "alert");
    banner.textContent =
      config.gapBannerText ||
      "Connection interrupted. Click to refresh.";
    banner.style.cursor = "pointer";

    banner.addEventListener("click", function () {
      window.location.reload();
    });

    el.prepend(banner);
  }

  /**
   * Handles a topics-changed event by dispatching a DOM event with the
   * parsed topic list.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   * @param {string} data - JSON payload from the server
   */
  function handleTopicsChanged(el, config, data) {
    var detail = {};
    try {
      detail = JSON.parse(data);
    } catch (_) {
      detail = { raw: data };
    }

    debug(config, "topics changed", detail);

    el.dispatchEvent(
      new CustomEvent("tavern:topics-changed", {
        bubbles: true,
        detail: detail,
      }),
    );
  }

  /**
   * Binds tavern event listeners to an SSE-connected element.
   * Idempotent — will not bind twice to the same element.
   *
   * @param {HTMLElement} el - An element with sse-connect attribute
   */
  function bind(el) {
    if (el._tavernBound) return;
    el._tavernBound = true;

    var config = readConfig(el);

    debug(config, "binding to", el);

    // HTMX SSE lifecycle events
    el.addEventListener("htmx:sseError", function () {
      markDisconnected(el, config);
    });

    el.addEventListener("htmx:sseOpen", function () {
      // Transport reopened — do NOT call markReconnected() here.
      // The server's tavern-reconnected control event is the authoritative
      // signal that recovery (replay, gap handling) is complete.
      // Dispatch a transport-level event for debugging / UI hints only.
      if (el._tavernDisconnected) {
        debug(config, "transport open (awaiting server confirmation)", el);
        el.dispatchEvent(
          new CustomEvent("tavern:transport-open", { bubbles: true }),
        );
      }
    });

    // Tavern control events (dispatched by HTMX SSE extension as DOM events)
    el.addEventListener(EVT_RECONNECTED, function () {
      markReconnected(el, config);
    });

    el.addEventListener(EVT_REPLAY_GAP, function (e) {
      var lastEventId = e.detail ? e.detail.data : "";
      handleReplayGap(el, config, lastEventId);
    });

    el.addEventListener(EVT_TOPICS_CHANGED, function (e) {
      var data = e.detail ? e.detail.data : "";
      handleTopicsChanged(el, config, data);
    });
  }

  /**
   * Scans the document for all elements with sse-connect and binds tavern
   * listeners to them.
   */
  function scanAndBind() {
    document.querySelectorAll("[sse-connect]").forEach(bind);
  }

  /**
   * Observes the DOM for dynamically added SSE connections and binds tavern
   * listeners automatically.
   */
  function observe() {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;

          if (node.hasAttribute && node.hasAttribute("sse-connect")) {
            bind(node);
          }

          // Check children of added subtrees
          if (node.querySelectorAll) {
            node.querySelectorAll("[sse-connect]").forEach(bind);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return observer;
  }

  /**
   * Initializes tavern.js: scans existing elements and starts observing
   * for new ones.
   *
   * @returns {{ observer: MutationObserver, bind: function }} Cleanup handle
   */
  function init() {
    scanAndBind();
    var observer = observe();
    return { observer: observer, bind: bind };
  }

  // Auto-initialize when the DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose for programmatic use
  if (typeof window !== "undefined") {
    window.Tavern = {
      bind: bind,
      init: init,
      scanAndBind: scanAndBind,
    };
  }

  // ES module export
  if (typeof exports !== "undefined") {
    exports.bind = bind;
    exports.init = init;
    exports.scanAndBind = scanAndBind;
  }
})();
