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
      expect(banner.textContent).toBe(
        "Connection interrupted. Click to refresh.",
      );
    });

    it("uses custom banner text", () => {
      const el = createSSEElement({
        "data-tavern-gap-action": "banner",
        "data-tavern-gap-banner-text": "Updates missed!",
      });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "");

      const banner = el.querySelector("[data-tavern-gap-banner]");
      expect(banner.textContent).toBe("Updates missed!");
    });

    it("banner is keyboard-accessible", () => {
      const el = createSSEElement({ "data-tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      const source = simulateSSEOpen(el);
      fireSSEEvent(source, "tavern-replay-gap", "");

      const banner = el.querySelector("[data-tavern-gap-banner]");
      expect(banner.tagName).toBe("BUTTON");
      expect(banner.getAttribute("type")).toBe("button");
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

describe("non-browser environment", () => {
  it("does not crash when document is undefined", async () => {
    const { execSync } = await import("node:child_process");
    const { resolve } = await import("node:path");
    const src = resolve(__dirname, "../src/tavern.js");
    // Run in plain Node (no jsdom) — should not throw
    execSync(`node -e "require('${src}')"`, { stdio: "pipe" });
  });
});
