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
 * Creates an element with sse-connect and optional data-tavern-* attributes.
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
  status.setAttribute("data-tavern-status", "");
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
        "data-tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);
    });

    it("applies multiple reconnecting classes", () => {
      const el = createSSEElement({
        "data-tavern-reconnecting-class": "opacity-50 blur-sm",
      });
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);
      expect(el.classList.contains("blur-sm")).toBe(true);
    });

    it("shows status elements on disconnect", () => {
      const el = createSSEElement({
        "data-tavern-reconnecting-class": "opacity-50",
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
        "data-tavern-reconnecting-class": "opacity-50",
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
        "data-tavern-reconnecting-class": "opacity-50",
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
        "data-tavern-reconnecting-class": "opacity-50",
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
      const el = createSSEElement({ "data-tavern-gap-action": "reload" });
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
      const el = createSSEElement({ "data-tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "evt-42");

      const banner = el.querySelector("[data-tavern-gap-banner]");
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
        "data-tavern-gap-action": "banner",
        "data-tavern-gap-banner-text": "Updates missed!",
      });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "");

      const alert = el.querySelector("[data-tavern-gap-banner] [role='alert']");
      expect(alert.textContent).toBe("Updates missed!");
    });

    it("banner separates alert region from interactive button", () => {
      const el = createSSEElement({ "data-tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "");

      const banner = el.querySelector("[data-tavern-gap-banner]");
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
      const el = createSSEElement({ "data-tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "");
      fireSSEEvent(source, "tavern-replay-gap", "");

      const banners = el.querySelectorAll("[data-tavern-gap-banner]");
      expect(banners.length).toBe(1);
    });

    it("dispatches custom event for unknown gap action", () => {
      const el = createSSEElement({
        "data-tavern-gap-action": "my-custom-refresh",
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
      const el = createSSEElement({ "data-tavern-debug": "" });
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

  it("registers element with data-tavern-role=lifeline as the lifeline", () => {
    const el = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(el);
    expect(window.Tavern.lifeline()).toBe(el);
  });

  it("Tavern.lifeline() returns null when no lifeline registered", () => {
    expect(window.Tavern.lifeline()).toBeNull();
  });

  it("only one lifeline allowed — second registration is ignored with console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el1 = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(el1);

    const el2 = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(el2);

    expect(window.Tavern.lifeline()).toBe(el1);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("duplicate lifeline");

    warnSpy.mockRestore();
  });

  it("allows new lifeline after previous lifeline is removed from DOM", () => {
    const el1 = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(el1);
    expect(window.Tavern.lifeline()).toBe(el1);

    // Remove lifeline from DOM
    el1.remove();

    // New lifeline should be accepted
    const el2 = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(el2);
    expect(window.Tavern.lifeline()).toBe(el2);
  });

  it("Tavern.lifeline() returns null when lifeline element is detached", () => {
    const el = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(el);
    expect(window.Tavern.lifeline()).toBe(el);

    el.remove();
    expect(window.Tavern.lifeline()).toBeNull();
  });

  it("lifeline survives scoped stream disconnect/reconnect", () => {
    const lifeline = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    const info = window.Tavern.stream("chat");
    expect(info).not.toBeNull();
    expect(info.state).toBe("warming");
    expect(info.el).toBe(el);
  });

  it("dispatches tavern:stream-warming on bind", () => {
    const el = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });

    const spy = vi.fn();
    el.addEventListener("tavern:stream-warming", spy);

    window.Tavern.bind(el);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].detail.scope).toBe("chat");
  });

  it("transitions to ready on htmx:sseOpen", () => {
    const el = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    simulateSSEOpen(el);

    expect(window.Tavern.stream("chat").state).toBe("ready");
  });

  it("dispatches tavern:stream-ready on sseOpen", () => {
    const el = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el);

    const info = window.Tavern.stream("chat");
    expect(info.el).toBe(el);
    expect(info.state).toBe("warming");
  });

  it("duplicate scope is rejected when existing element is still in DOM", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const el1 = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el1);

    const el2 = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el2);

    expect(window.Tavern.stream("chat").el).toBe(el1);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("duplicate scope");

    warnSpy.mockRestore();
  });

  it("allows scope takeover when previous owner is removed from DOM", () => {
    const el1 = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el1);

    el1.remove();

    const el2 = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el2);

    expect(window.Tavern.stream("chat").el).toBe(el2);
  });

  it("old element error does not trigger fallback after scope takeover", () => {
    const lifeline = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const el1 = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el1);
    simulateSSEOpen(el1);
    window.Tavern.promote("chat");

    // Remove old element, bind replacement
    el1.remove();

    const el2 = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    const el2 = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "notifications",
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
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(el);
    simulateSSEOpen(el);

    window.Tavern.promote("chat");
    expect(window.Tavern.stream("chat").state).toBe("active");
  });

  it("dispatches tavern:stream-promoted on promote", () => {
    const el = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
    const lifeline = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
    const lifeline = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);
    simulateSSEOpen(scoped);
    window.Tavern.promote("chat");

    scoped.dispatchEvent(new Event("htmx:sseError"));

    expect(window.Tavern.stream("chat").state).toBe("warming");
  });

  it("does not dispatch fallback when scoped stream is not active", () => {
    const lifeline = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
      "data-tavern-role": "lifeline",
      "data-tavern-reconnecting-class": "opacity-50",
    });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
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
    lifeline.setAttribute("data-tavern-role", "lifeline");
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
    const lifeline = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);

    // Retire the scoped stream
    window.Tavern.retire("chat");

    // Lifeline unaffected
    expect(window.Tavern.lifeline()).toBe(lifeline);
    expect(window.Tavern.stream("chat")).toBeNull();
  });

  it("destroy() clears lifeline and streams state", () => {
    const lifeline = createSSEElement({ "data-tavern-role": "lifeline" });
    window.Tavern.bind(lifeline);

    const scoped = createSSEElement({
      "data-tavern-role": "scoped",
      "data-tavern-scope": "chat",
    });
    window.Tavern.bind(scoped);

    window.Tavern.destroy();

    expect(window.Tavern.lifeline()).toBeNull();
    expect(Object.keys(window.Tavern.streams())).toEqual([]);
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
