/**
 * tavern.js — Client-side companion for the tavern SSE pub/sub engine.
 *
 * Listens for tavern control events on HTMX SSE connections and translates
 * them into declarative, attribute-driven UI behaviors.
 *
 * Control events handled:
 * - tavern-reconnected  — fires when the server confirms a reconnection
 * - tavern-replay-gap   — fires when the replay log cannot satisfy Last-Event-ID
 * - tavern-topics-changed — fires when subscription topics change at runtime
 *
 * @module tavern
 * @version 0.0.17
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

  /** @type {MutationObserver|null} Active observer instance, if initialized */
  var _observer = null;

  /** @type {boolean} Whether tavern has been initialized */
  var _initialized = false;

  /** @type {HTMLElement|null} The lifeline element, if registered */
  var _lifeline = null;

  /**
   * @typedef {Object} StreamEntry
   * @property {HTMLElement} el - The scoped stream element
   * @property {string} state - Current state: "warming", "ready", "active", or "retired"
   */

  /** @type {Object.<string, StreamEntry>} Map of scope name to stream entry */
  var _streams = {};

  /**
   * @typedef {Object} TavernConfig
   * @property {string} [reconnectingClass] - CSS class applied during disconnection
   * @property {string} [gapAction] - Action on replay gap: "reload", "banner", or custom event name
   * @property {string} [gapBannerText] - Text for the gap banner (default: "Connection interrupted. Click to refresh.")
   * @property {boolean} [debug] - Enable debug logging
   * @property {string} [staleClass] - CSS class(es) applied when region becomes stale
   * @property {string} [liveClass] - CSS class(es) applied when region is live
   */

  /**
   * Reads tavern configuration from data attributes on an element.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @returns {TavernConfig} Parsed configuration
   */
  function readConfig(el) {
    return {
      reconnectingClass: el.getAttribute("tavern-reconnecting-class"),
      gapAction: el.getAttribute("tavern-gap-action"),
      gapBannerText: el.getAttribute("tavern-gap-banner-text"),
      debug: el.hasAttribute("tavern-debug"),
      role: el.getAttribute("tavern-role"),
      scope: el.getAttribute("tavern-scope"),
      commandDelegate: el.getAttribute("tavern-command-delegate"),
      commandTarget: el.getAttribute("tavern-command-target"),
      hotPolicy: el.getAttribute("tavern-hot-policy"),
      staleClass: el.getAttribute("tavern-stale-class"),
      liveClass: el.getAttribute("tavern-live-class"),
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
   * Shows all [tavern-status] children within an element.
   *
   * @param {HTMLElement} el - Parent element to search within
   */
  function showStatus(el) {
    el.querySelectorAll("[tavern-status]").forEach(function (s) {
      s.classList.remove("hidden");
      s.removeAttribute("hidden");
    });
  }

  /**
   * Hides all [tavern-status] children within an element.
   *
   * @param {HTMLElement} el - Parent element to search within
   */
  function hideStatus(el) {
    el.querySelectorAll("[tavern-status]").forEach(function (s) {
      s.classList.add("hidden");
      s.setAttribute("hidden", "");
    });
  }

  /**
   * Shows all children matching a given attribute selector within an element.
   *
   * @param {HTMLElement} el - Parent element to search within
   * @param {string} attr - Attribute name to select (e.g. "tavern-status-live")
   */
  function showStatusByAttr(el, attr) {
    el.querySelectorAll("[" + attr + "]").forEach(function (s) {
      s.classList.remove("hidden");
      s.removeAttribute("hidden");
    });
  }

  /**
   * Hides all children matching a given attribute selector within an element.
   *
   * @param {HTMLElement} el - Parent element to search within
   * @param {string} attr - Attribute name to select (e.g. "tavern-status-stale")
   */
  function hideStatusByAttr(el, attr) {
    el.querySelectorAll("[" + attr + "]").forEach(function (s) {
      s.classList.add("hidden");
      s.setAttribute("hidden", "");
    });
  }

  /**
   * Applies a space-separated list of CSS classes to an element.
   *
   * @param {HTMLElement} el - Target element
   * @param {string} classes - Space-separated CSS class names
   */
  function addClasses(el, classes) {
    if (!classes) return;
    classes.split(/\s+/).forEach(function (cls) {
      if (cls) el.classList.add(cls);
    });
  }

  /**
   * Removes a space-separated list of CSS classes from an element.
   *
   * @param {HTMLElement} el - Target element
   * @param {string} classes - Space-separated CSS class names
   */
  function removeClasses(el, classes) {
    if (!classes) return;
    classes.split(/\s+/).forEach(function (cls) {
      if (cls) el.classList.remove(cls);
    });
  }

  /**
   * Central state transition function for region state.
   * Updates el._tavernRegionState, toggles stale/live classes,
   * shows/hides status elements, and dispatches DOM events.
   *
   * Valid states: "connecting", "live", "disconnected", "recovering", "stale"
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   * @param {string} newState - The new region state
   * @param {Object} [detail] - Optional detail for dispatched events
   */
  function setRegionState(el, config, newState, detail) {
    var oldState = el._tavernRegionState;
    if (oldState === newState) return;

    el._tavernRegionState = newState;

    debug(config, "region state:", oldState, "→", newState);

    if (newState === "connecting") {
      removeClasses(el, config.liveClass);
      removeClasses(el, config.staleClass);
      hideStatusByAttr(el, "tavern-status-live");
      hideStatusByAttr(el, "tavern-status-stale");
      hideStatusByAttr(el, "tavern-status-recovering");
    } else if (newState === "live") {
      addClasses(el, config.liveClass);
      removeClasses(el, config.staleClass);
      showStatusByAttr(el, "tavern-status-live");
      hideStatusByAttr(el, "tavern-status-stale");
      hideStatusByAttr(el, "tavern-status-recovering");
      el.dispatchEvent(
        new CustomEvent("tavern:live", { bubbles: true, detail: detail || {} }),
      );
    } else if (newState === "disconnected") {
      removeClasses(el, config.liveClass);
      removeClasses(el, config.staleClass);
      hideStatusByAttr(el, "tavern-status-live");
      hideStatusByAttr(el, "tavern-status-stale");
      hideStatusByAttr(el, "tavern-status-recovering");
    } else if (newState === "recovering") {
      removeClasses(el, config.liveClass);
      removeClasses(el, config.staleClass);
      hideStatusByAttr(el, "tavern-status-live");
      hideStatusByAttr(el, "tavern-status-stale");
      showStatusByAttr(el, "tavern-status-recovering");
      el.dispatchEvent(
        new CustomEvent("tavern:recovering", {
          bubbles: true,
          detail: detail || {},
        }),
      );
    } else if (newState === "stale") {
      addClasses(el, config.staleClass);
      removeClasses(el, config.liveClass);
      hideStatusByAttr(el, "tavern-status-live");
      showStatusByAttr(el, "tavern-status-stale");
      hideStatusByAttr(el, "tavern-status-recovering");
      el.dispatchEvent(
        new CustomEvent("tavern:stale", {
          bubbles: true,
          detail: detail || { reason: "replay-gap" },
        }),
      );
    }
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

    setRegionState(el, config, "disconnected");

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

    setRegionState(el, config, "live");

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
      setRegionState(el, config, "stale", { reason: "replay-gap" });
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
      setRegionState(el, config, "stale", { reason: "replay-gap" });
      showGapBanner(el, config);
      return;
    }

    // Custom event name — dispatch it
    setRegionState(el, config, "stale", { reason: "replay-gap" });
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
    if (el.querySelector("[tavern-gap-banner]")) return;

    var wrapper = document.createElement("div");
    wrapper.setAttribute("tavern-gap-banner", "");

    var msg = document.createElement("span");
    msg.setAttribute("role", "alert");
    msg.textContent =
      config.gapBannerText || "Connection interrupted — some events were missed.";

    var btn = document.createElement("button");
    btn.setAttribute("type", "button");
    btn.textContent = "Refresh";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", function () {
      window.location.reload();
    });

    wrapper.appendChild(msg);
    wrapper.appendChild(btn);
    el.prepend(wrapper);
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
   * Attaches control event listeners directly to an EventSource instance.
   * Deduplicates by tracking the bound source on the element — if the same
   * source is passed again, this is a no-op. When the source changes (HTMX
   * creates a new EventSource on reconnect), old listeners are removed first.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   * @param {EventSource} source - The EventSource to listen on
   */
  function bindControlEvents(el, config, source) {
    if (source === el._tavernControlSource) return;

    // Remove listeners from the previous source, if any.
    if (el._tavernControlSource) {
      debug(config, "detaching control listeners from old EventSource");
      el._tavernControlSource.removeEventListener(
        EVT_RECONNECTED,
        el._tavernOnReconnected,
      );
      el._tavernControlSource.removeEventListener(
        EVT_REPLAY_GAP,
        el._tavernOnReplayGap,
      );
      el._tavernControlSource.removeEventListener(
        EVT_TOPICS_CHANGED,
        el._tavernOnTopicsChanged,
      );
    }

    // Create stable references so they can be removed later.
    el._tavernOnReconnected = function () {
      markReconnected(el, config);
    };
    el._tavernOnReplayGap = function (e) {
      handleReplayGap(el, config, e.data || "");
    };
    el._tavernOnTopicsChanged = function (e) {
      handleTopicsChanged(el, config, e.data || "");
    };

    source.addEventListener(EVT_RECONNECTED, el._tavernOnReconnected);
    source.addEventListener(EVT_REPLAY_GAP, el._tavernOnReplayGap);
    source.addEventListener(EVT_TOPICS_CHANGED, el._tavernOnTopicsChanged);

    el._tavernControlSource = source;

    debug(config, "attached control listeners to EventSource", source);
  }

  /**
   * Binds tavern event listeners to an SSE-connected element.
   * Idempotent — will not bind twice to the same element.
   *
   * Control events (tavern-reconnected, tavern-replay-gap, tavern-topics-changed)
   * are listened on the EventSource directly, not as DOM events on the element.
   * The HTMX SSE extension does not dispatch raw SSE event names as DOM events,
   * so attaching to the EventSource via htmx:sseOpen is the only reliable path.
   *
   * @param {HTMLElement} el - An element with sse-connect attribute
   */
  function bind(el) {
    if (el._tavernBound) return;
    el._tavernBound = true;

    var config = readConfig(el);

    debug(config, "binding to", el);

    // Delegated commands
    bindDelegatedCommands(el, config);

    // Initialize region state to "connecting" — not yet live until SSE opens
    el._tavernRegionState = "connecting";
    hideStatusByAttr(el, "tavern-status-live");
    hideStatusByAttr(el, "tavern-status-stale");
    hideStatusByAttr(el, "tavern-status-recovering");

    // Lifeline registration
    if (config.role === "lifeline") {
      if (_lifeline && document.body.contains(_lifeline)) {
        console.warn("[tavern] duplicate lifeline ignored — only one allowed");
      } else {
        _lifeline = el;
        debug(config, "registered lifeline", el);
      }
    }

    // Scoped stream registration
    if (config.role === "scoped" && config.scope) {
      var existing = _streams[config.scope];
      if (existing && existing.el !== el && document.body.contains(existing.el)) {
        console.warn(
          "[tavern] duplicate scope '" + config.scope + "' ignored — already owned by another element",
        );
      } else {
        _streams[config.scope] = { el: el, state: "warming" };
        debug(config, "registered scoped stream", config.scope);
        el.dispatchEvent(
          new CustomEvent("tavern:stream-warming", {
            bubbles: true,
            detail: { scope: config.scope },
          }),
        );
      }
    }

    // Hot-region interaction protection
    if (config.hotPolicy) {
      bindHotPolicy(el, config);
    }

    // HTMX SSE lifecycle events
    el.addEventListener("htmx:sseError", function () {
      markDisconnected(el, config);

      // Scoped stream fallback logic — only act if this element still owns the scope
      if (config.role === "scoped" && config.scope) {
        var entry = _streams[config.scope];
        if (entry && entry.el === el) {
          if (entry.state === "active" && _lifeline) {
            _lifeline.dispatchEvent(
              new CustomEvent("tavern:stream-fallback", {
                bubbles: true,
                detail: { scope: config.scope },
              }),
            );
          }
          if (entry.state !== "retired") {
            entry.state = "warming";
          }
        }
      }
    });

    el.addEventListener("htmx:sseOpen", function (e) {
      // First connection: transition from "connecting" to "live"
      if (el._tavernRegionState === "connecting") {
        setRegionState(el, config, "live");
      }

      // Transport reopened — do NOT call markReconnected() here.
      // The server's tavern-reconnected control event is the authoritative
      // signal that recovery (replay, gap handling) is complete.
      // Dispatch a transport-level event for debugging / UI hints only.
      if (el._tavernDisconnected) {
        debug(config, "transport open (awaiting server confirmation)", el);
        setRegionState(el, config, "recovering");
        el.dispatchEvent(
          new CustomEvent("tavern:transport-open", { bubbles: true }),
        );
      }

      // Scoped stream transitions to "ready" on sseOpen — only if this element owns the scope
      if (config.role === "scoped" && config.scope) {
        var entry = _streams[config.scope];
        if (entry && entry.el === el && entry.state === "warming") {
          entry.state = "ready";
          el.dispatchEvent(
            new CustomEvent("tavern:stream-ready", {
              bubbles: true,
              detail: { scope: config.scope },
            }),
          );
        }
      }

      // Attach control event listeners to the EventSource. HTMX creates a
      // new EventSource on each reconnect, so we must re-attach each time.
      // bindControlEvents deduplicates by source identity.
      var source = e.detail && e.detail.source;
      if (source) {
        bindControlEvents(el, config, source);
      }
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
   * Promotes a scoped stream to the "active" state.
   * Dispatches `tavern:stream-promoted` on the stream element.
   *
   * @param {string} name - The scope name of the stream to promote
   * @returns {boolean} True if the stream was promoted, false if not found or not promotable
   */
  function promote(name) {
    var entry = _streams[name];
    if (!entry) return false;
    entry.state = "active";
    entry.el.dispatchEvent(
      new CustomEvent("tavern:stream-promoted", {
        bubbles: true,
        detail: { scope: name },
      }),
    );
    return true;
  }

  /**
   * Retires a scoped stream: sets state to "retired", dispatches
   * `tavern:stream-retired`, and removes it from the streams registry.
   *
   * @param {string} name - The scope name of the stream to retire
   * @returns {boolean} True if the stream was retired, false if not found
   */
  function retire(name) {
    var entry = _streams[name];
    if (!entry) return false;
    entry.state = "retired";
    entry.el.dispatchEvent(
      new CustomEvent("tavern:stream-retired", {
        bubbles: true,
        detail: { scope: name },
      }),
    );
    delete _streams[name];
    return true;
  }

  /**
   * Returns the lifeline element, or null if none registered.
   *
   * @returns {HTMLElement|null} The lifeline element
   */
  function getLifeline() {
    if (_lifeline && !document.body.contains(_lifeline)) {
      _lifeline = null;
    }
    return _lifeline;
  }

  /**
   * Returns stream info for a scoped stream by name.
   *
   * @param {string} name - The scope name
   * @returns {{ el: HTMLElement, state: string }|null} Stream info or null
   */
  function getStream(name) {
    var entry = _streams[name];
    if (!entry) return null;
    return { el: entry.el, state: entry.state };
  }

  /**
   * Returns a shallow copy of all registered scoped streams.
   *
   * @returns {Object.<string, { el: HTMLElement, state: string }>} All streams
   */
  function getStreams() {
    var copy = {};
    for (var key in _streams) {
      if (_streams.hasOwnProperty(key)) {
        copy[key] = { el: _streams[key].el, state: _streams[key].state };
      }
    }
    return copy;
  }

  /**
   * Tears down tavern.js: disconnects the observer and resets state.
   * After calling destroy(), init() can be called again to re-initialize.
   */
  function destroy() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
    _lifeline = null;
    _streams = {};
    _initialized = false;
  }

  /**
   * Initializes tavern.js: scans existing elements and starts observing
   * for new ones. Idempotent — subsequent calls re-scan but do not create
   * additional observers.
   *
   * @returns {{ observer: MutationObserver, bind: function, destroy: function }} Handle
   */
  function init() {
    scanAndBind();
    if (!_initialized) {
      _observer = observe();
      _initialized = true;
    }
    return { observer: _observer, bind: bind, destroy: destroy };
  }

  /**
   * Sends a command POST to an application endpoint.
   *
   * Designed for hot SSE-driven DOM regions where node-bound handlers
   * (hx-post, click listeners) are unreliable due to rapid DOM replacement.
   * The server processes the command and publishes any UI updates via SSE.
   *
   * @param {string} url - The endpoint to POST to
   * @param {Object} [body={}] - JSON-serializable request body
   * @param {Object} [options] - Optional fetch overrides
   * @param {Object} [options.headers] - Additional headers (merged with Content-Type)
   * @param {AbortSignal} [options.signal] - AbortSignal for cancellation
   * @param {string} [options.credentials] - Fetch credentials mode
   * @returns {Promise<Response>} Resolves on 2xx, rejects on error or non-2xx
   */
  function command(url, body, options) {
    var opts = options || {};
    var headers = { "Content-Type": "application/json" };
    if (opts.headers) {
      for (var key in opts.headers) {
        if (opts.headers.hasOwnProperty(key)) {
          headers[key] = opts.headers[key];
        }
      }
    }
    var fetchOpts = {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body || {}),
    };
    if (opts.signal) fetchOpts.signal = opts.signal;
    if (opts.credentials) fetchOpts.credentials = opts.credentials;

    return fetch(url, fetchOpts).then(function (response) {
      if (!response.ok) {
        throw new Error(
          "Tavern.command: " + response.status + " " + response.statusText,
        );
      }
      return response;
    });
  }

  /**
   * Collects command-* attributes from an element into a plain object,
   * excluding command-url which is used as the endpoint.
   *
   * @param {HTMLElement} el - The element to read attributes from
   * @returns {Object} Key-value pairs, e.g. { id: "42", action: "complete" }
   */
  function collectCommandAttrs(el) {
    var result = {};
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      if (name === "command-url") continue;
      if (name.indexOf("command-") === 0) {
        var key = name.slice(8); // strip "command-"
        result[key] = attrs[i].value;
      }
    }
    return result;
  }

  /** @type {string[]} Known hot-policy keywords */
  var KNOWN_HOT_POLICIES = ["pause-on-pointerdown", "defer-on-focus"];

  /**
   * Parses a space-separated hot-policy string into an array of valid
   * policy keywords. Unknown keywords are logged as warnings and ignored.
   *
   * @param {string} str - Space-separated policy keywords
   * @returns {string[]} Array of valid policy keywords
   */
  function parseHotPolicies(str) {
    if (!str) return [];
    var tokens = str.trim().split(/\s+/);
    var result = [];
    for (var i = 0; i < tokens.length; i++) {
      if (KNOWN_HOT_POLICIES.indexOf(tokens[i]) !== -1) {
        result.push(tokens[i]);
      } else if (tokens[i]) {
        console.warn("[tavern] unknown hot-policy keyword: " + tokens[i]);
      }
    }
    return result;
  }

  /**
   * Binds a delegated event listener on a parent element for declarative
   * command dispatching. Reads `tavern-command-delegate` (event type) and
   * `tavern-command-target` (CSS selector for closest()) from the element.
   *
   * When the delegated event fires, the listener finds the nearest matching
   * ancestor of the event target, reads its `command-url` and `command-*`
   * attributes, and calls `command()`.
   *
   * @param {HTMLElement} el - The SSE-connected parent element
   * @param {TavernConfig} config - Current configuration
   */
  function bindDelegatedCommands(el, config) {
    if (!config.commandDelegate || !config.commandTarget) return;

    var eventType = config.commandDelegate;
    var selector = config.commandTarget;

    debug(config, "binding delegated commands", eventType, selector);

    el.addEventListener(eventType, function (e) {
      var target = e.target.closest(selector);
      if (!target || !el.contains(target)) return;

      var url = target.getAttribute("command-url");
      if (!url) return;

      var body = collectCommandAttrs(target);

      target.dispatchEvent(
        new CustomEvent("tavern:command-sent", {
          bubbles: true,
          detail: { url: url, body: body },
        }),
      );

      command(url, body).then(
        function (response) {
          target.dispatchEvent(
            new CustomEvent("tavern:command-success", {
              bubbles: true,
              detail: { url: url, body: body, response: response },
            }),
          );
        },
        function (error) {
          target.dispatchEvent(
            new CustomEvent("tavern:command-error", {
              bubbles: true,
              detail: { url: url, body: body, error: error },
            }),
          );
        },
      );
    });
  }

  /**
   * Binds hot-region interaction protection to an SSE-connected element.
   *
   * When a policy is active (pointer held down or focus inside the region),
   * incoming `htmx:sseBeforeMessage` events are intercepted via
   * `preventDefault()` and their data is queued. When the interaction ends,
   * the queue is discarded (the next natural SSE message will bring current
   * state) and a `tavern:policy-deactivated` event is dispatched.
   *
   * @param {HTMLElement} el - The SSE-connected element
   * @param {TavernConfig} config - Current configuration
   */
  function bindHotPolicy(el, config) {
    var policies = parseHotPolicies(config.hotPolicy);
    if (policies.length === 0) return;

    /** @type {boolean} Whether pointer is currently held down inside the region */
    var pointerActive = false;

    /** @type {boolean} Whether a focusable element inside the region has focus */
    var focusActive = false;

    /** @type {Array<{ type: string, data: * }>} Queued SSE messages */
    var queue = [];

    /**
     * Returns true if any policy is currently suppressing swaps.
     *
     * @returns {boolean}
     */
    function isSuppressing() {
      return pointerActive || focusActive;
    }

    /**
     * Dispatches `tavern:policy-activated` on the element.
     *
     * @param {string} policy - The policy keyword that activated
     */
    function activatePolicy(policy) {
      debug(config, "hot-policy activated:", policy);
      el.dispatchEvent(
        new CustomEvent("tavern:policy-activated", {
          bubbles: true,
          detail: { policy: policy },
        }),
      );
    }

    /**
     * Flushes the queue and dispatches `tavern:policy-deactivated`.
     * The queue is cleared — the next natural SSE message brings current
     * content, so replaying stale messages is unnecessary.
     *
     * @param {string} policy - The policy keyword that deactivated
     */
    function deactivatePolicy(policy) {
      if (isSuppressing()) return; // Another policy still active

      var flushed = queue.length;
      queue = [];

      debug(config, "hot-policy deactivated:", policy, "flushed:", flushed);
      el.dispatchEvent(
        new CustomEvent("tavern:policy-deactivated", {
          bubbles: true,
          detail: { policy: policy, flushed: flushed },
        }),
      );
    }

    // --- pause-on-pointerdown ---
    if (policies.indexOf("pause-on-pointerdown") !== -1) {
      el.addEventListener("pointerdown", function () {
        if (!pointerActive) {
          pointerActive = true;
          activatePolicy("pause-on-pointerdown");
        }
      });

      /**
       * Handles pointer release or cancellation.
       * Attached to `document` so that releases outside the region are
       * still captured (e.g. user drags pointer outside before releasing).
       * Only acts when this element's pointerActive flag is set.
       */
      function onPointerEnd() {
        if (pointerActive) {
          pointerActive = false;
          deactivatePolicy("pause-on-pointerdown");
        }
      }

      document.addEventListener("pointerup", onPointerEnd);
      document.addEventListener("pointercancel", onPointerEnd);
    }

    // --- defer-on-focus ---
    if (policies.indexOf("defer-on-focus") !== -1) {
      el.addEventListener("focusin", function () {
        if (!focusActive) {
          focusActive = true;
          activatePolicy("defer-on-focus");
        }
      });

      el.addEventListener("focusout", function (e) {
        // Only deactivate if focus is leaving the region entirely.
        // relatedTarget is the element receiving focus — if it's inside
        // the region, focus hasn't truly left.
        if (focusActive) {
          var next = e.relatedTarget;
          if (!next || !el.contains(next)) {
            focusActive = false;
            deactivatePolicy("defer-on-focus");
          }
        }
      });
    }

    // --- htmx:sseBeforeMessage interception ---
    el.addEventListener("htmx:sseBeforeMessage", function (evt) {
      if (!isSuppressing()) return;

      evt.preventDefault();

      var detail = evt.detail || {};
      var sseType = detail.type || "";
      var sseData = detail.data;

      // Keep only the last message per SSE event type (dedup)
      var found = false;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].type === sseType) {
          queue[i].data = sseData;
          found = true;
          break;
        }
      }
      if (!found) {
        queue.push({ type: sseType, data: sseData });
      }

      debug(config, "hot-policy queued message:", sseType, "queue size:", queue.length);
    });
  }

  // Auto-initialize when the DOM is ready
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // Expose for programmatic use
  if (typeof window !== "undefined") {
    window.Tavern = {
      bind: bind,
      init: init,
      scanAndBind: scanAndBind,
      destroy: destroy,
      lifeline: getLifeline,
      stream: getStream,
      streams: getStreams,
      promote: promote,
      retire: retire,
      command: command,
    };
  }

  // ES module export
  if (typeof exports !== "undefined") {
    exports.bind = bind;
    exports.init = init;
    exports.scanAndBind = scanAndBind;
    exports.destroy = destroy;
    exports.lifeline = getLifeline;
    exports.stream = getStream;
    exports.streams = getStreams;
    exports.promote = promote;
    exports.retire = retire;
    exports.command = command;
  }
})();
