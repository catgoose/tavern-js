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

      // Reconnect — new EventSource fires tavern-reconnected
      const source2 = simulateSSEOpen(el);
      fireSSEEvent(source2, "tavern-reconnected");
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

    it("dispatches tavern:reconnected custom event", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      const source = simulateSSEOpen(el);

      // Must disconnect first
      el.dispatchEvent(new Event("htmx:sseError"));

      const source2 = simulateSSEOpen(el);
      fireSSEEvent(source2, "tavern-reconnected");
      expect(spy).toHaveBeenCalledOnce();
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
    it("dispatches tavern:replay-gap event by default", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-gap", spy);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "evt-42");
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
      fireSSEEvent(source, "tavern-replay-gap", "evt-42");
      expect(reloadSpy).toHaveBeenCalledOnce();
    });

    it("shows banner when gap action is banner", () => {
      const el = createSSEElement({ "tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "evt-42");

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
      fireSSEEvent(source, "tavern-replay-gap", "");

      const alert = el.querySelector("[tavern-gap-banner] [role='alert']");
      expect(alert.textContent).toBe("Updates missed!");
    });

    it("banner separates alert region from interactive button", () => {
      const el = createSSEElement({ "tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "");

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
      fireSSEEvent(source, "tavern-replay-gap", "");
      fireSSEEvent(source, "tavern-replay-gap", "");

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
      fireSSEEvent(source, "tavern-replay-gap", "evt-42");
      expect(spy).toHaveBeenCalledOnce();
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

describe("non-browser environment", () => {
  it("does not crash when document is undefined", async () => {
    const { execSync } = await import("node:child_process");
    const { resolve } = await import("node:path");
    const src = resolve(__dirname, "../src/tavern.js");
    // Run in plain Node (no jsdom) — should not throw
    execSync(`node -e "require('${src}')"`, { stdio: "pipe" });
  });
});
