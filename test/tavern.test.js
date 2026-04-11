import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Load tavern.js in each test by evaluating the source.
 * This ensures a clean state per test suite.
 */
async function loadTavern() {
  // Reset any previous state
  delete window.Tavern;

  // Import the module (vitest handles IIFE via dynamic import workaround)
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(
    path.resolve(__dirname, "../src/tavern.js"),
    "utf-8",
  );

  // Execute in current jsdom context
  // Note: jsdom does not execute <script> elements, so we use eval instead.
  const fn = new Function(src);
  fn();
}

/**
 * Creates an element with sse-connect and optional tavern-* attributes.
 *
 * @param {Object} [attrs] - Additional attributes to set
 * @returns {HTMLElement}
 */
function createSSEElement(attrs = {}) {
  const el = document.createElement("div");
  el.setAttribute("sse-connect", "/sse/test");
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  document.body.appendChild(el);
  return el;
}

/**
 * Creates a status element inside a parent.
 *
 * @param {HTMLElement} parent
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function createStatusElement(parent, text = "Reconnecting...") {
  const status = document.createElement("div");
  status.setAttribute("tavern-status", "");
  status.classList.add("hidden");
  status.setAttribute("hidden", "");
  status.textContent = text;
  parent.appendChild(status);
  return status;
}

/**
 * Creates a mock EventSource-like object that supports addEventListener,
 * removeEventListener, and dispatching events.
 *
 * @returns {EventTarget & { _listeners: Object }}
 */
function createMockEventSource() {
  const target = new EventTarget();
  return target;
}

/**
 * Simulates htmx:sseOpen on an element with a mock EventSource.
 *
 * @param {HTMLElement} el - The SSE-connected element
 * @param {EventTarget} [source] - Mock EventSource (created if not provided)
 * @returns {EventTarget} The mock EventSource
 */
function simulateSSEOpen(el, source) {
  if (!source) source = createMockEventSource();
  el.dispatchEvent(
    new CustomEvent("htmx:sseOpen", { detail: { source: source } }),
  );
  return source;
}

/**
 * Dispatches a named SSE event on a mock EventSource.
 *
 * @param {EventTarget} source - Mock EventSource
 * @param {string} eventName - SSE event type name
 * @param {string} [data] - Event data payload
 */
function fireSSEEvent(source, eventName, data) {
  const evt = new MessageEvent(eventName, { data: data || "" });
  source.dispatchEvent(evt);
}

describe("tavern.js", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  describe("auto-discovery", () => {
    it("binds to existing sse-connect elements on init", () => {
      const el = createSSEElement();
      window.Tavern.scanAndBind();
      expect(el._tavernBound).toBe(true);
    });

    it("binds to dynamically added sse-connect elements", async () => {
      const el = createSSEElement();
      // MutationObserver is async, give it a tick
      await new Promise((r) => setTimeout(r, 0));
      expect(el._tavernBound).toBe(true);
    });

    it("does not double-bind the same element", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);
      window.Tavern.bind(el);
      expect(el._tavernBound).toBe(true);
    });
  });

  describe("disconnection detection", () => {
    it("applies reconnecting class on htmx:sseError", () => {
      const el = createSSEElement({
        "tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);
    });

    it("applies multiple reconnecting classes", () => {
      const el = createSSEElement({
        "tavern-reconnecting-class": "opacity-50 blur-sm",
      });
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);
      expect(el.classList.contains("blur-sm")).toBe(true);
    });

    it("shows status elements on disconnect", () => {
      const el = createSSEElement({
        "tavern-reconnecting-class": "opacity-50",
      });
      const status = createStatusElement(el);
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(status.classList.contains("hidden")).toBe(false);
      expect(status.hasAttribute("hidden")).toBe(false);
    });

    it("dispatches tavern:disconnected custom event", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:disconnected", spy);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(spy).toHaveBeenCalledOnce();
    });

    it("does not fire disconnect twice without reconnect", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:disconnected", spy);

      el.dispatchEvent(new Event("htmx:sseError"));
      el.dispatchEvent(new Event("htmx:sseError"));
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("reconnection", () => {
    it("removes reconnecting class on tavern-reconnected from EventSource", () => {
      const el = createSSEElement({
        "tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      // Initial connection
      const source = simulateSSEOpen(el);

      // Disconnect
      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Reconnect — new EventSource fires tavern-reconnected with JSON payload
      const source2 = simulateSSEOpen(el);
      fireSSEEvent(source2, "tavern-reconnected", JSON.stringify({ replayDelivered: 3, replayDropped: 0 }));
      expect(el.classList.contains("opacity-50")).toBe(false);
    });

    it("hides status elements on reconnect", () => {
      const el = createSSEElement();
      const status = createStatusElement(el);
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(status.classList.contains("hidden")).toBe(false);

      const source2 = simulateSSEOpen(el);
      fireSSEEvent(source2, "tavern-reconnected");
      expect(status.classList.contains("hidden")).toBe(true);
      expect(status.hasAttribute("hidden")).toBe(true);
    });

    it("dispatches tavern:reconnected custom event with parsed JSON detail", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      const source = simulateSSEOpen(el);

      // Must disconnect first
      el.dispatchEvent(new Event("htmx:sseError"));

      const source2 = simulateSSEOpen(el);
      fireSSEEvent(source2, "tavern-reconnected", JSON.stringify({ replayDelivered: 5, replayDropped: 2 }));
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail.replayDelivered).toBe(5);
      expect(spy.mock.calls[0][0].detail.replayDropped).toBe(2);
    });

    it("does not clear disconnected state on htmx:sseOpen alone", () => {
      const el = createSSEElement({
        "tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Transport reopen should NOT clear disconnected state
      simulateSSEOpen(el);
      expect(el.classList.contains("opacity-50")).toBe(true);
      expect(el._tavernDisconnected).toBe(true);
    });

    it("clears disconnected state only on server tavern-reconnected event", () => {
      const el = createSSEElement({
        "tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Transport reopen — still disconnected
      const source2 = simulateSSEOpen(el);
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Server confirms recovery — now reconnected
      fireSSEEvent(source2, "tavern-reconnected");
      expect(el.classList.contains("opacity-50")).toBe(false);
      expect(el._tavernDisconnected).toBe(false);
    });

    it("dispatches tavern:transport-open on htmx:sseOpen after disconnect", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const transportSpy = vi.fn();
      const reconnectedSpy = vi.fn();
      el.addEventListener("tavern:transport-open", transportSpy);
      el.addEventListener("tavern:reconnected", reconnectedSpy);

      const source = simulateSSEOpen(el);
      el.dispatchEvent(new Event("htmx:sseError"));
      simulateSSEOpen(el);

      // Transport event fires, but reconnected does not
      expect(transportSpy).toHaveBeenCalledOnce();
      expect(reconnectedSpy).not.toHaveBeenCalled();
    });

    it("does not dispatch tavern:transport-open on initial connection", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:transport-open", spy);

      simulateSSEOpen(el);
      expect(spy).not.toHaveBeenCalled();
    });

    it("ignores htmx:sseOpen on initial connection", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      simulateSSEOpen(el);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("EventSource listener dedupe", () => {
    it("does not attach duplicate listeners for the same source", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const source = createMockEventSource();
      const spy = vi.fn();

      // Open twice with the same source
      simulateSSEOpen(el, source);
      simulateSSEOpen(el, source);

      el.dispatchEvent(new Event("htmx:sseError"));

      el.addEventListener("tavern:reconnected", spy);
      fireSSEEvent(source, "tavern-reconnected");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("detaches listeners from old source when source changes", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const source1 = simulateSSEOpen(el);

      el.dispatchEvent(new Event("htmx:sseError"));

      // New source on reconnect
      const source2 = simulateSSEOpen(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      // Event on OLD source should NOT trigger handler
      fireSSEEvent(source1, "tavern-reconnected");
      expect(spy).not.toHaveBeenCalled();

      // Event on NEW source should trigger handler
      fireSSEEvent(source2, "tavern-reconnected");
      expect(spy).toHaveBeenCalledOnce();
    });

    it("tracks current source on the element", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const source1 = simulateSSEOpen(el);
      expect(el._tavernControlSource).toBe(source1);

      const source2 = simulateSSEOpen(el);
      expect(el._tavernControlSource).toBe(source2);
    });
  });

  describe("replay gap", () => {
    it("dispatches tavern:replay-gap event with parsed JSON detail", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-gap", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-42" }));
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail.lastEventId).toBe("evt-42");
    });

    it("reloads page when gap action is reload", () => {
      const el = createSSEElement({ "tavern-gap-action": "reload" });
      window.Tavern.bind(el);

      const reloadSpy = vi.fn();
      Object.defineProperty(window, "location", {
        value: { reload: reloadSpy },
        writable: true,
      });

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-42" }));
      expect(reloadSpy).toHaveBeenCalledOnce();
    });

    it("shows banner when gap action is banner", () => {
      const el = createSSEElement({ "tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-42" }));

      const banner = el.querySelector("[tavern-gap-banner]");
      expect(banner).not.toBeNull();

      const alert = banner.querySelector("[role='alert']");
      expect(alert).not.toBeNull();
      expect(alert.textContent).toBe(
        "Connection interrupted — some events were missed.",
      );

      const btn = banner.querySelector("button");
      expect(btn).not.toBeNull();
      expect(btn.textContent).toBe("Refresh");
    });

    it("uses custom banner text", () => {
      const el = createSSEElement({
        "tavern-gap-action": "banner",
        "tavern-gap-banner-text": "Updates missed!",
      });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "" }));

      const alert = el.querySelector("[tavern-gap-banner] [role='alert']");
      expect(alert.textContent).toBe("Updates missed!");
    });

    it("banner separates alert region from interactive button", () => {
      const el = createSSEElement({ "tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "" }));

      const banner = el.querySelector("[tavern-gap-banner]");
      // Wrapper is a div, not a button
      expect(banner.tagName).toBe("DIV");

      // Alert region is non-interactive span
      const alert = banner.querySelector("[role='alert']");
      expect(alert.tagName).toBe("SPAN");

      // Button is a separate interactive element
      const btn = banner.querySelector("button");
      expect(btn.getAttribute("type")).toBe("button");
    });

    it("does not create duplicate banners", () => {
      const el = createSSEElement({ "tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "" }));
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "" }));

      const banners = el.querySelectorAll("[tavern-gap-banner]");
      expect(banners.length).toBe(1);
    });

    it("dispatches custom event for unknown gap action", () => {
      const el = createSSEElement({
        "tavern-gap-action": "my-custom-refresh",
      });
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("my-custom-refresh", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-42" }));
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail.lastEventId).toBe("evt-42");
    });
  });

  describe("topics changed", () => {
    it("dispatches tavern:topics-changed with parsed JSON", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:topics-changed", spy);

      const payload = JSON.stringify({
        added: ["chat.room1"],
        removed: [],
      });
      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-topics-changed", payload);

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail.added).toEqual(["chat.room1"]);
    });

    it("handles non-JSON payload gracefully", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:topics-changed", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-topics-changed", "not json");

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail.raw).toBe("not json");
    });
  });

  describe("replay truncated", () => {
    it("dispatches tavern:replay-truncated with parsed JSON detail", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-truncated", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-truncated", JSON.stringify({ delivered: 10, dropped: 3 }));
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail.delivered).toBe(10);
      expect(spy.mock.calls[0][0].detail.dropped).toBe(3);
    });

    it("handles empty data gracefully", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-truncated", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-truncated", "");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail).toEqual({});
    });

    it("handles malformed JSON gracefully", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-truncated", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-truncated", "not json");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail).toEqual({});
    });
  });

  describe("control event JSON parsing resilience", () => {
    it("tavern-reconnected with empty data dispatches empty detail", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      const source = simulateSSEOpen(el);
      el.dispatchEvent(new Event("htmx:sseError"));
      const source2 = simulateSSEOpen(el);
      fireSSEEvent(source2, "tavern-reconnected", "");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail).toEqual({});
    });

    it("tavern-reconnected with malformed data dispatches empty detail", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      const source = simulateSSEOpen(el);
      el.dispatchEvent(new Event("htmx:sseError"));
      const source2 = simulateSSEOpen(el);
      fireSSEEvent(source2, "tavern-reconnected", "not json");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail).toEqual({});
    });

    it("tavern-replay-gap with empty data dispatches empty detail", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-gap", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail).toEqual({});
    });

    it("tavern-replay-gap with malformed data dispatches empty detail", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-gap", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "not json");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail).toEqual({});
    });
  });

  describe("init idempotency and destroy", () => {
    it("does not create multiple observers on repeated init()", () => {
      const handle1 = window.Tavern.init();
      const handle2 = window.Tavern.init();
      // Same observer instance returned
      expect(handle2.observer).toBe(handle1.observer);
    });

    it("re-scans elements on repeated init()", () => {
      window.Tavern.init();
      const el = createSSEElement();
      window.Tavern.init();
      expect(el._tavernBound).toBe(true);
    });

    it("destroy() disconnects observer and allows re-init", () => {
      const handle = window.Tavern.init();
      const disconnectSpy = vi.spyOn(handle.observer, "disconnect");

      window.Tavern.destroy();
      expect(disconnectSpy).toHaveBeenCalledOnce();

      // Re-init should work and create a new observer
      const handle2 = window.Tavern.init();
      expect(handle2.observer).not.toBe(handle.observer);
    });
  });

  describe("debug mode", () => {
    it("logs when debug attribute is present", () => {
      const el = createSSEElement({ "tavern-debug": "" });
      window.Tavern.bind(el);

      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(debugSpy).toHaveBeenCalled();
      expect(debugSpy.mock.calls[0][0]).toBe("[tavern]");

      debugSpy.mockRestore();
    });

    it("does not log without debug attribute", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(debugSpy).not.toHaveBeenCalled();

      debugSpy.mockRestore();
    });
  });
});

describe("lifeline registration", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  it("registers element with tavern-role=lifeline as the lifeline", () => {
    const el = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(el);
    expect(window.Tavern.lifeline()).toBe(el);
  });

  it("Tavern.lifeline() returns null when no lifeline registered", () => {
    expect(window.Tavern.lifeline()).toBeNull();
  });

  it("only one lifeline allowed — second registration is ignored with console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el1 = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(el1);

    const el2 = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(el2);

    expect(window.Tavern.lifeline()).toBe(el1);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("duplicate lifeline");

    warnSpy.mockRestore();
  });

  it("allows new lifeline after previous lifeline is removed from DOM", () => {
    const el1 = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(el1);
    expect(window.Tavern.lifeline()).toBe(el1);

    // Remove lifeline from DOM
    el1.remove();

    // New lifeline should be accepted
    const el2 = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(el2);
    expect(window.Tavern.lifeline()).toBe(el2);
  });

  it("Tavern.lifeline() returns null when lifeline element is detached", () => {
    const el = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(el);
    expect(window.Tavern.lifeline()).toBe(el);

    el.remove();
    expect(window.Tavern.lifeline()).toBeNull();
  });

  it("lifeline survives scoped stream disconnect/reconnect", () => {
    const lifeline = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);

    // Scoped stream disconnects
    scoped.dispatchEvent(new Event("htmx:sseError"));

    // Lifeline is unaffected
    expect(window.Tavern.lifeline()).toBe(lifeline);
    expect(lifeline._tavernDisconnected).toBeFalsy();
  });
});

describe("scoped stream lifecycle", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  it("scoped stream starts in warming state on bind", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    const info = window.Tavern.stream("chat");
    expect(info).not.toBeNull();
    expect(info.state).toBe("warming");
    expect(info.el).toBe(el);
  });

  it("dispatches tavern:stream-warming on bind", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });

    const spy = vi.fn();
    el.addEventListener("tavern:stream-warming", spy);

    window.Tavern.bind(el);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.scope).toBe("chat");
  });

  it("transitions to ready on htmx:sseOpen", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    simulateSSEOpen(el);

    expect(window.Tavern.stream("chat").state).toBe("ready");
  });

  it("dispatches tavern:stream-ready on sseOpen", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:stream-ready", spy);

    simulateSSEOpen(el);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.scope).toBe("chat");
  });

  it("Tavern.stream(name) returns { el, state } or null", () => {
    expect(window.Tavern.stream("nonexistent")).toBeNull();

    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    const info = window.Tavern.stream("chat");
    expect(info.el).toBe(el);
    expect(info.state).toBe("warming");
  });

  it("duplicate scope is rejected when existing element is still in DOM", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el1 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el1);

    const el2 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el2);

    expect(window.Tavern.stream("chat").el).toBe(el1);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("duplicate scope");

    warnSpy.mockRestore();
  });

  it("allows scope takeover when previous owner is removed from DOM", () => {
    const el1 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el1);

    el1.remove();

    const el2 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el2);

    expect(window.Tavern.stream("chat").el).toBe(el2);
  });

  it("old element error does not trigger fallback after scope takeover", () => {
    const lifeline = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const el1 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el1);
    simulateSSEOpen(el1);
    window.Tavern.promote("chat");

    // Remove old element, bind replacement
    el1.remove();

    const el2 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el2);
    simulateSSEOpen(el2);
    window.Tavern.promote("chat");

    const spy = vi.fn();
    lifeline.addEventListener("tavern:stream-fallback", spy);

    // Error on OLD element should NOT trigger fallback
    el1.dispatchEvent(new Event("htmx:sseError"));
    expect(spy).not.toHaveBeenCalled();

    // Error on NEW element should trigger fallback
    el2.dispatchEvent(new Event("htmx:sseError"));
    expect(spy).toHaveBeenCalledOnce();
  });

  it("Tavern.streams() returns all registered streams", () => {
    const el1 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    const el2 = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "notifications",
    });
    window.Tavern.bind(el1);
    window.Tavern.bind(el2);

    const streams = window.Tavern.streams();
    expect(Object.keys(streams)).toEqual(["chat", "notifications"]);
    expect(streams.chat.el).toBe(el1);
    expect(streams.notifications.el).toBe(el2);
  });
});

describe("stream promotion and retirement", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  it("Tavern.promote(name) sets state to active", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);
    simulateSSEOpen(el);

    window.Tavern.promote("chat");
    expect(window.Tavern.stream("chat").state).toBe("active");
  });

  it("dispatches tavern:stream-promoted on promote", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:stream-promoted", spy);

    window.Tavern.promote("chat");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.scope).toBe("chat");
  });

  it("Tavern.promote returns false for unknown stream", () => {
    expect(window.Tavern.promote("nonexistent")).toBe(false);
  });

  it("Tavern.retire(name) sets state to retired", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:stream-retired", spy);

    window.Tavern.retire("chat");
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.scope).toBe("chat");
  });

  it("retired stream removed from Tavern.streams()", () => {
    const el = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    window.Tavern.retire("chat");
    expect(window.Tavern.stream("chat")).toBeNull();
    expect(Object.keys(window.Tavern.streams())).toEqual([]);
  });

  it("Tavern.retire returns false for unknown stream", () => {
    expect(window.Tavern.retire("nonexistent")).toBe(false);
  });
});

describe("scoped stream fallback", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  it("dispatches tavern:stream-fallback on lifeline when active scoped stream errors", () => {
    const lifeline = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);
    simulateSSEOpen(scoped);
    window.Tavern.promote("chat");

    const spy = vi.fn();
    lifeline.addEventListener("tavern:stream-fallback", spy);

    scoped.dispatchEvent(new Event("htmx:sseError"));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.scope).toBe("chat");
  });

  it("scoped stream goes back to warming on error", () => {
    const lifeline = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);
    simulateSSEOpen(scoped);
    window.Tavern.promote("chat");

    scoped.dispatchEvent(new Event("htmx:sseError"));

    expect(window.Tavern.stream("chat").state).toBe("warming");
  });

  it("does not dispatch fallback when scoped stream is not active", () => {
    const lifeline = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);
    simulateSSEOpen(scoped);
    // Stream is "ready" but not "active"

    const spy = vi.fn();
    lifeline.addEventListener("tavern:stream-fallback", spy);

    scoped.dispatchEvent(new Event("htmx:sseError"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("lifeline connection state is unaffected by scoped stream errors", () => {
    const lifeline = createSSEElement({
      "tavern-role": "lifeline",
      "tavern-reconnecting-class": "opacity-50",
    });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);
    simulateSSEOpen(scoped);
    window.Tavern.promote("chat");

    scoped.dispatchEvent(new Event("htmx:sseError"));

    // Lifeline should NOT be marked disconnected
    expect(lifeline._tavernDisconnected).toBeFalsy();
    expect(lifeline.classList.contains("opacity-50")).toBe(false);
  });
});

describe("shell persistence during navigation", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  it("lifeline element stays bound when sibling content is replaced", () => {
    const shell = document.createElement("div");
    document.body.appendChild(shell);

    const lifeline = document.createElement("div");
    lifeline.setAttribute("sse-connect", "/sse/global");
    lifeline.setAttribute("tavern-role", "lifeline");
    shell.appendChild(lifeline);
    window.Tavern.bind(lifeline);

    const content = document.createElement("div");
    content.id = "content";
    shell.appendChild(content);

    // Replace sibling content
    shell.removeChild(content);
    const newContent = document.createElement("div");
    newContent.id = "content-new";
    shell.appendChild(newContent);

    // Lifeline still registered
    expect(window.Tavern.lifeline()).toBe(lifeline);
    expect(lifeline._tavernBound).toBe(true);
  });

  it("scoped stream can be added/removed without affecting lifeline", () => {
    const lifeline = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);

    // Retire the scoped stream
    window.Tavern.retire("chat");

    // Lifeline unaffected
    expect(window.Tavern.lifeline()).toBe(lifeline);
    expect(window.Tavern.stream("chat")).toBeNull();
  });

  it("destroy() clears lifeline and streams state", () => {
    const lifeline = createSSEElement({ "tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "tavern-role": "scoped",
      "tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);

    window.Tavern.destroy();

    expect(window.Tavern.lifeline()).toBeNull();
    expect(Object.keys(window.Tavern.streams())).toEqual([]);
  });
});

describe("command()", () => {
  beforeEach(async () => {
    await loadTavern();
    // Stub global fetch
    globalThis.fetch = vi.fn();
  });

  it("sends POST with JSON body to the provided URL", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const result = await window.Tavern.command("/calendar/select-day", { d: "2026-04-15" });

    expect(globalThis.fetch).toHaveBeenCalledWith("/calendar/select-day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ d: "2026-04-15" }),
    });
    expect(result.ok).toBe(true);
  });

  it("defaults body to empty object when omitted", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    await window.Tavern.command("/dismiss");

    expect(globalThis.fetch).toHaveBeenCalledWith("/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("forwards headers option merged with Content-Type", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    await window.Tavern.command("/api/action", { x: 1 }, {
      headers: { "X-Custom": "value" },
    });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Custom": "value" },
      body: JSON.stringify({ x: 1 }),
    });
  });

  it("forwards signal option", async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    await window.Tavern.command("/api/action", {}, { signal: controller.signal });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: controller.signal,
    });
  });

  it("forwards credentials option", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    await window.Tavern.command("/api/action", {}, { credentials: "include" });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      credentials: "include",
    });
  });

  it("rejects on non-2xx response", async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 422, statusText: "Unprocessable Entity" });

    await expect(window.Tavern.command("/api/fail", {})).rejects.toThrow(
      "Tavern.command: 422 Unprocessable Entity",
    );
  });

  it("rejects on network failure", async () => {
    globalThis.fetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(window.Tavern.command("/api/down", {})).rejects.toThrow(
      "Failed to fetch",
    );
  });

  it("resolves without assuming response payload", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 204, statusText: "No Content" });

    const result = await window.Tavern.command("/api/noop", {});
    expect(result.status).toBe(204);
  });
});

describe("delegated commands", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
    globalThis.fetch = vi.fn();
  });

  /**
   * Creates a child element with command-url and optional command-* attributes.
   *
   * @param {HTMLElement} parent - Parent element to append to
   * @param {Object} [attrs] - Attributes to set on the child
   * @returns {HTMLElement}
   */
  function createCommandChild(parent, attrs = {}) {
    const child = document.createElement("button");
    for (const [key, value] of Object.entries(attrs)) {
      child.setAttribute(key, value);
    }
    parent.appendChild(child);
    return child;
  }

  it("click on a matching child triggers Tavern.command() with correct URL and body", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    const child = createCommandChild(el, {
      "command-url": "/tasks/complete",
      "command-id": "42",
    });

    child.click();

    expect(globalThis.fetch).toHaveBeenCalledWith("/tasks/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "42" }),
    });
  });

  it("click on a non-matching child is ignored", () => {
    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    // Child without command-url
    const child = document.createElement("span");
    child.textContent = "no command here";
    el.appendChild(child);

    child.click();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("multiple command-* attributes are collected into body", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    const child = createCommandChild(el, {
      "command-url": "/tasks/update",
      "command-id": "42",
      "command-action": "complete",
      "command-priority": "high",
    });

    child.click();

    const callBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(callBody.id).toBe("42");
    expect(callBody.action).toBe("complete");
    expect(callBody.priority).toBe("high");
  });

  it("command-url is not included in body", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    const child = createCommandChild(el, {
      "command-url": "/tasks/complete",
      "command-id": "42",
    });

    child.click();

    const callBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(callBody.url).toBeUndefined();
    expect(callBody.id).toBe("42");
  });

  it("tavern:command-sent event fires on the matched element", () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    const child = createCommandChild(el, {
      "command-url": "/tasks/complete",
      "command-id": "42",
    });

    const spy = vi.fn();
    child.addEventListener("tavern:command-sent", spy);

    child.click();

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.url).toBe("/tasks/complete");
    expect(spy.mock.calls[0][0].detail.body).toEqual({ id: "42" });
  });

  it("tavern:command-success event fires on successful response", async () => {
    const mockResponse = { ok: true, status: 200, statusText: "OK" };
    globalThis.fetch.mockResolvedValue(mockResponse);

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    const child = createCommandChild(el, {
      "command-url": "/tasks/complete",
      "command-id": "42",
    });

    const spy = vi.fn();
    child.addEventListener("tavern:command-success", spy);

    child.click();

    // Wait for the promise to resolve
    await vi.waitFor(() => {
      expect(spy).toHaveBeenCalledOnce();
    });

    expect(spy.mock.calls[0][0].detail.url).toBe("/tasks/complete");
    expect(spy.mock.calls[0][0].detail.body).toEqual({ id: "42" });
    expect(spy.mock.calls[0][0].detail.response).toBe(mockResponse);
  });

  it("tavern:command-error event fires on failed response", async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, statusText: "Internal Server Error" });

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    const child = createCommandChild(el, {
      "command-url": "/tasks/complete",
      "command-id": "42",
    });

    const spy = vi.fn();
    child.addEventListener("tavern:command-error", spy);

    child.click();

    await vi.waitFor(() => {
      expect(spy).toHaveBeenCalledOnce();
    });

    expect(spy.mock.calls[0][0].detail.url).toBe("/tasks/complete");
    expect(spy.mock.calls[0][0].detail.body).toEqual({ id: "42" });
    expect(spy.mock.calls[0][0].detail.error).toBeInstanceOf(Error);
    expect(spy.mock.calls[0][0].detail.error.message).toContain("500");
  });

  it("nested matching — closest() finds the nearest ancestor with the selector", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    window.Tavern.bind(el);

    const wrapper = createCommandChild(el, {
      "command-url": "/tasks/complete",
      "command-id": "42",
    });

    // Nested span inside the command element
    const inner = document.createElement("span");
    inner.textContent = "Done";
    wrapper.appendChild(inner);

    inner.click();

    expect(globalThis.fetch).toHaveBeenCalledWith("/tasks/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "42" }),
    });
  });

  it("closest() match outside the bound parent is ignored", () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    // Create a wrapper that itself matches [command-url] — it sits OUTSIDE the SSE element
    const outer = document.createElement("div");
    outer.setAttribute("command-url", "/should-not-fire");
    outer.setAttribute("command-id", "999");
    document.body.appendChild(outer);

    const el = createSSEElement({
      "tavern-command-delegate": "click",
      "tavern-command-target": "[command-url]",
    });
    // Move el inside the outer wrapper so closest() could walk up to it
    outer.appendChild(el);

    window.Tavern.bind(el);

    // Click a plain child inside el — closest("[command-url]") would walk up to `outer`
    const child = document.createElement("span");
    child.textContent = "click me";
    el.appendChild(child);

    child.click();

    // The outer element is outside el, so the command must NOT fire
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("element without tavern-command-delegate does not set up delegation", () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, statusText: "OK" });

    const el = createSSEElement();
    window.Tavern.bind(el);

    const child = createCommandChild(el, {
      "command-url": "/tasks/complete",
      "command-id": "42",
    });

    child.click();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

/**
 * Creates a status element with a given attribute inside a parent.
 *
 * @param {HTMLElement} parent
 * @param {string} attr - Attribute name (e.g. "tavern-status-live")
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function createStatusByAttr(parent, attr, text = "") {
  const el = document.createElement("span");
  el.setAttribute(attr, "");
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

describe("hot-region interaction protection", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  /**
   * Dispatches a cancelable htmx:sseBeforeMessage event on the element.
   *
   * @param {HTMLElement} el - Target element
   * @param {string} type - SSE event type
   * @param {string} data - SSE message data
   * @returns {CustomEvent} The dispatched event
   */
  function fireSSEBeforeMessage(el, type, data) {
    const evt = new CustomEvent("htmx:sseBeforeMessage", {
      cancelable: true,
      bubbles: true,
      detail: { type: type, data: data },
    });
    el.dispatchEvent(evt);
    return evt;
  }

  it("pause-on-pointerdown suppresses htmx:sseBeforeMessage while pointer is down", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown" });
    window.Tavern.bind(el);

    // Before pointerdown — message should NOT be suppressed
    const evt1 = fireSSEBeforeMessage(el, "tasks", "<li>task1</li>");
    expect(evt1.defaultPrevented).toBe(false);

    // Pointerdown — message should be suppressed
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const evt2 = fireSSEBeforeMessage(el, "tasks", "<li>task2</li>");
    expect(evt2.defaultPrevented).toBe(true);

    // Pointerup — message should NOT be suppressed
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));
    const evt3 = fireSSEBeforeMessage(el, "tasks", "<li>task3</li>");
    expect(evt3.defaultPrevented).toBe(false);
  });

  it("pause-on-pointerdown deactivates when pointer is released outside the region", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown" });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:policy-deactivated", spy);

    // Pointer down inside the region
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const evt1 = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt1.defaultPrevented).toBe(true);

    // Pointer released outside the region (on document.body)
    document.body.dispatchEvent(new Event("pointerup", { bubbles: true }));

    // Policy should have deactivated — swaps resume
    const evt2 = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt2.defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.policy).toBe("pause-on-pointerdown");
  });

  it("pause-on-pointerdown handles pointercancel", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown" });
    window.Tavern.bind(el);

    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const evt1 = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt1.defaultPrevented).toBe(true);

    el.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    const evt2 = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt2.defaultPrevented).toBe(false);
  });

  it("defer-on-focus suppresses htmx:sseBeforeMessage while focus is inside", () => {
    const el = createSSEElement({ "tavern-hot-policy": "defer-on-focus" });
    const input = document.createElement("input");
    el.appendChild(input);
    window.Tavern.bind(el);

    // Before focusin — not suppressed
    const evt1 = fireSSEBeforeMessage(el, "tasks", "<li>task1</li>");
    expect(evt1.defaultPrevented).toBe(false);

    // Focusin — suppressed
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: null }));
    const evt2 = fireSSEBeforeMessage(el, "tasks", "<li>task2</li>");
    expect(evt2.defaultPrevented).toBe(true);

    // Focusout leaving the region — not suppressed
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    const evt3 = fireSSEBeforeMessage(el, "tasks", "<li>task3</li>");
    expect(evt3.defaultPrevented).toBe(false);
  });

  it("defer-on-focus stays active when focus moves within the region", () => {
    const el = createSSEElement({ "tavern-hot-policy": "defer-on-focus" });
    const input1 = document.createElement("input");
    const input2 = document.createElement("input");
    el.appendChild(input1);
    el.appendChild(input2);
    window.Tavern.bind(el);

    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    // Focus moves from input1 to input2 — relatedTarget is inside el
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: input2 }));

    const evt = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt.defaultPrevented).toBe(true);
  });

  it("combined policies — both active simultaneously", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown defer-on-focus" });
    const input = document.createElement("input");
    el.appendChild(input);
    window.Tavern.bind(el);

    // Activate both
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    const evt1 = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt1.defaultPrevented).toBe(true);

    // Release pointer — focus still active, should still suppress
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));
    const evt2 = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt2.defaultPrevented).toBe(true);

    // Release focus — now should not suppress
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));
    const evt3 = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt3.defaultPrevented).toBe(false);
  });

  it("dispatches tavern:policy-activated when suppression starts", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown" });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:policy-activated", spy);

    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.policy).toBe("pause-on-pointerdown");
  });

  it("dispatches tavern:policy-deactivated with flushed count when suppression ends", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown" });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:policy-deactivated", spy);

    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fireSSEBeforeMessage(el, "tasks", "<li>task1</li>");
    fireSSEBeforeMessage(el, "status", "OK");
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.policy).toBe("pause-on-pointerdown");
    expect(spy.mock.calls[0][0].detail.flushed).toBe(2);
  });

  it("queues messages while paused and deduplicates by event type", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown" });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:policy-deactivated", spy);

    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    // Send multiple messages of the same type — only last should be kept
    fireSSEBeforeMessage(el, "tasks", "<li>task1</li>");
    fireSSEBeforeMessage(el, "tasks", "<li>task2</li>");
    fireSSEBeforeMessage(el, "tasks", "<li>task3</li>");

    el.dispatchEvent(new Event("pointerup", { bubbles: true }));

    // Only 1 unique type was queued
    expect(spy.mock.calls[0][0].detail.flushed).toBe(1);
  });

  it("element without tavern-hot-policy is not affected", () => {
    const el = createSSEElement();
    window.Tavern.bind(el);

    // Message should pass through without being prevented
    const evt = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt.defaultPrevented).toBe(false);
  });

  it("unknown policy keywords are ignored with console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown unknown-policy" });
    window.Tavern.bind(el);

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("unknown hot-policy keyword");

    // Valid policy should still work
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const evt = fireSSEBeforeMessage(el, "tasks", "<li>task</li>");
    expect(evt.defaultPrevented).toBe(true);

    warnSpy.mockRestore();
  });

  it("queue is cleared after deactivation", () => {
    const el = createSSEElement({ "tavern-hot-policy": "pause-on-pointerdown" });
    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:policy-deactivated", spy);

    // First cycle
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    fireSSEBeforeMessage(el, "tasks", "<li>task1</li>");
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(spy.mock.calls[0][0].detail.flushed).toBe(1);

    // Second cycle — queue should be fresh
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(spy.mock.calls[1][0].detail.flushed).toBe(0);
  });
});

describe("stale/live UX primitives", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await loadTavern();
  });

  it("initial state is connecting — all status indicators hidden", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
      "tavern-stale-class": "opacity-50",
    });
    const statusLive = createStatusByAttr(el, "tavern-status-live", "Live");
    const statusStale = createStatusByAttr(el, "tavern-status-stale", "Stale");
    const statusRecovering = createStatusByAttr(el, "tavern-status-recovering", "Recovering");

    window.Tavern.bind(el);

    expect(el._tavernRegionState).toBe("connecting");
    expect(statusLive.classList.contains("hidden")).toBe(true);
    expect(statusLive.hasAttribute("hidden")).toBe(true);
    expect(statusStale.classList.contains("hidden")).toBe(true);
    expect(statusRecovering.classList.contains("hidden")).toBe(true);
    expect(el.classList.contains("opacity-100")).toBe(false);
    expect(el.classList.contains("opacity-50")).toBe(false);
  });

  it("transitions to live on first sseOpen — live class applied, tavern:live fires", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
      "tavern-stale-class": "opacity-50",
    });
    const statusLive = createStatusByAttr(el, "tavern-status-live", "Live");
    const statusStale = createStatusByAttr(el, "tavern-status-stale", "Stale");
    statusStale.classList.add("hidden");
    statusStale.setAttribute("hidden", "");

    window.Tavern.bind(el);

    const spy = vi.fn();
    el.addEventListener("tavern:live", spy);

    simulateSSEOpen(el);

    expect(el._tavernRegionState).toBe("live");
    expect(el.classList.contains("opacity-100")).toBe(true);
    expect(el.classList.contains("opacity-50")).toBe(false);
    expect(statusLive.classList.contains("hidden")).toBe(false);
    expect(statusLive.hasAttribute("hidden")).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("tavern-live-class not applied until sseOpen, tavern-stale-class not applied", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
      "tavern-stale-class": "opacity-50",
    });
    window.Tavern.bind(el);

    // Before sseOpen: neither class applied
    expect(el.classList.contains("opacity-100")).toBe(false);
    expect(el.classList.contains("opacity-50")).toBe(false);

    // After sseOpen: live class applied
    simulateSSEOpen(el);
    expect(el.classList.contains("opacity-100")).toBe(true);
    expect(el.classList.contains("opacity-50")).toBe(false);
  });

  it("on sseError state becomes disconnected, live class removed", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
      "tavern-stale-class": "opacity-50",
    });
    window.Tavern.bind(el);
    simulateSSEOpen(el);

    expect(el._tavernRegionState).toBe("live");
    expect(el.classList.contains("opacity-100")).toBe(true);

    el.dispatchEvent(new Event("htmx:sseError"));

    expect(el._tavernRegionState).toBe("disconnected");
    expect(el.classList.contains("opacity-100")).toBe(false);
    expect(el.classList.contains("opacity-50")).toBe(false);
  });

  it("on sseOpen after error state becomes recovering, tavern:recovering fires", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
    });
    const statusRecovering = createStatusByAttr(el, "tavern-status-recovering", "Recovering...");
    statusRecovering.classList.add("hidden");
    statusRecovering.setAttribute("hidden", "");

    window.Tavern.bind(el);
    const source = simulateSSEOpen(el);

    el.dispatchEvent(new Event("htmx:sseError"));

    const spy = vi.fn();
    el.addEventListener("tavern:recovering", spy);

    simulateSSEOpen(el);

    expect(el._tavernRegionState).toBe("recovering");
    expect(spy).toHaveBeenCalledOnce();
    expect(statusRecovering.classList.contains("hidden")).toBe(false);
    expect(statusRecovering.hasAttribute("hidden")).toBe(false);
  });

  it("on tavern-reconnected state becomes live, live class applied, stale class removed, tavern:live fires", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
      "tavern-stale-class": "opacity-50",
    });
    window.Tavern.bind(el);
    const source = simulateSSEOpen(el);

    // Disconnect
    el.dispatchEvent(new Event("htmx:sseError"));

    // Reconnect
    const source2 = simulateSSEOpen(el);

    const spy = vi.fn();
    el.addEventListener("tavern:live", spy);

    fireSSEEvent(source2, "tavern-reconnected");

    expect(el._tavernRegionState).toBe("live");
    expect(el.classList.contains("opacity-100")).toBe(true);
    expect(el.classList.contains("opacity-50")).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("on replay-gap (non-reload) state becomes stale, tavern:stale fires", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
      "tavern-stale-class": "opacity-50",
    });
    const statusStale = createStatusByAttr(el, "tavern-status-stale", "Stale");
    statusStale.classList.add("hidden");
    statusStale.setAttribute("hidden", "");

    window.Tavern.bind(el);
    const source = simulateSSEOpen(el);

    const spy = vi.fn();
    el.addEventListener("tavern:stale", spy);

    fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-99" }));

    expect(el._tavernRegionState).toBe("stale");
    expect(el.classList.contains("opacity-50")).toBe(true);
    expect(el.classList.contains("opacity-100")).toBe(false);
    expect(statusStale.classList.contains("hidden")).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.reason).toBe("replay-gap");
  });

  it("on tavern-reconnected after stale, state becomes live again", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100",
      "tavern-stale-class": "opacity-50",
    });
    window.Tavern.bind(el);
    const source = simulateSSEOpen(el);

    // Go stale via replay-gap
    fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-99" }));
    expect(el._tavernRegionState).toBe("stale");

    // Need to disconnect and reconnect to get tavern-reconnected
    el.dispatchEvent(new Event("htmx:sseError"));
    const source2 = simulateSSEOpen(el);
    fireSSEEvent(source2, "tavern-reconnected");

    expect(el._tavernRegionState).toBe("live");
    expect(el.classList.contains("opacity-100")).toBe(true);
    expect(el.classList.contains("opacity-50")).toBe(false);
  });

  it("existing tavern-status and tavern-reconnecting-class behavior unchanged", () => {
    const el = createSSEElement({
      "tavern-reconnecting-class": "opacity-50",
    });
    const status = createStatusElement(el);
    window.Tavern.bind(el);

    // Disconnect
    el.dispatchEvent(new Event("htmx:sseError"));
    expect(el.classList.contains("opacity-50")).toBe(true);
    expect(status.classList.contains("hidden")).toBe(false);
    expect(status.hasAttribute("hidden")).toBe(false);

    // Reconnect
    const source = simulateSSEOpen(el);
    fireSSEEvent(source, "tavern-reconnected");
    expect(el.classList.contains("opacity-50")).toBe(false);
    expect(status.classList.contains("hidden")).toBe(true);
    expect(status.hasAttribute("hidden")).toBe(true);
  });

  it("multiple space-separated classes work for stale-class and live-class", () => {
    const el = createSSEElement({
      "tavern-live-class": "opacity-100 border-green",
      "tavern-stale-class": "opacity-50 border-red",
    });
    window.Tavern.bind(el);

    // Before sseOpen: no classes applied (connecting state)
    expect(el.classList.contains("opacity-100")).toBe(false);
    expect(el.classList.contains("border-green")).toBe(false);

    const source = simulateSSEOpen(el);

    // After sseOpen: live classes applied
    expect(el.classList.contains("opacity-100")).toBe(true);
    expect(el.classList.contains("border-green")).toBe(true);

    // Go stale
    fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-1" }));
    expect(el.classList.contains("opacity-50")).toBe(true);
    expect(el.classList.contains("border-red")).toBe(true);
    expect(el.classList.contains("opacity-100")).toBe(false);
    expect(el.classList.contains("border-green")).toBe(false);

    // Recover
    el.dispatchEvent(new Event("htmx:sseError"));
    const source2 = simulateSSEOpen(el);
    fireSSEEvent(source2, "tavern-reconnected");
    expect(el.classList.contains("opacity-100")).toBe(true);
    expect(el.classList.contains("border-green")).toBe(true);
    expect(el.classList.contains("opacity-50")).toBe(false);
    expect(el.classList.contains("border-red")).toBe(false);
  });

  it("replay-gap with banner action still sets stale state", () => {
    const el = createSSEElement({
      "tavern-gap-action": "banner",
      "tavern-stale-class": "opacity-50",
    });
    window.Tavern.bind(el);
    const source = simulateSSEOpen(el);

    fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-1" }));

    expect(el._tavernRegionState).toBe("stale");
    expect(el.classList.contains("opacity-50")).toBe(true);
    expect(el.querySelector("[tavern-gap-banner]")).not.toBeNull();
  });

  it("replay-gap with custom event action still sets stale state", () => {
    const el = createSSEElement({
      "tavern-gap-action": "my-custom-event",
      "tavern-stale-class": "opacity-50",
    });
    window.Tavern.bind(el);
    const source = simulateSSEOpen(el);

    const spy = vi.fn();
    el.addEventListener("my-custom-event", spy);

    fireSSEEvent(source, "tavern-replay-gap", JSON.stringify({ lastEventId: "evt-1" }));

    expect(el._tavernRegionState).toBe("stale");
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("non-browser environment", () => {
  it("does not crash when document is undefined", async () => {
    const { execSync } = await import("node:child_process");
    const { resolve } = await import("node:path");
    const src = resolve(__dirname, "../src/tavern.js");
    // Run in plain Node (no jsdom) — should not throw
    execSync(`node -e "require('${src}')"`, { stdio: "pipe" });
  });
});
