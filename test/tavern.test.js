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
    it("removes reconnecting class on tavern-reconnected", () => {
      const el = createSSEElement({
        "data-tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      // Disconnect first
      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Reconnect
      el.dispatchEvent(new Event("tavern-reconnected"));
      expect(el.classList.contains("opacity-50")).toBe(false);
    });

    it("hides status elements on reconnect", () => {
      const el = createSSEElement();
      const status = createStatusElement(el);
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(status.classList.contains("hidden")).toBe(false);

      el.dispatchEvent(new Event("tavern-reconnected"));
      expect(status.classList.contains("hidden")).toBe(true);
      expect(status.hasAttribute("hidden")).toBe(true);
    });

    it("dispatches tavern:reconnected custom event", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      // Must disconnect first
      el.dispatchEvent(new Event("htmx:sseError"));
      el.dispatchEvent(new Event("tavern-reconnected"));
      expect(spy).toHaveBeenCalledOnce();
    });

    it("does not clear disconnected state on htmx:sseOpen alone", () => {
      const el = createSSEElement({
        "data-tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Transport reopen should NOT clear disconnected state
      el.dispatchEvent(new Event("htmx:sseOpen"));
      expect(el.classList.contains("opacity-50")).toBe(true);
      expect(el._tavernDisconnected).toBe(true);
    });

    it("clears disconnected state only on server tavern-reconnected event", () => {
      const el = createSSEElement({
        "data-tavern-reconnecting-class": "opacity-50",
      });
      window.Tavern.bind(el);

      el.dispatchEvent(new Event("htmx:sseError"));
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Transport reopen — still disconnected
      el.dispatchEvent(new Event("htmx:sseOpen"));
      expect(el.classList.contains("opacity-50")).toBe(true);

      // Server confirms recovery — now reconnected
      el.dispatchEvent(new Event("tavern-reconnected"));
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

      el.dispatchEvent(new Event("htmx:sseError"));
      el.dispatchEvent(new Event("htmx:sseOpen"));

      // Transport event fires, but reconnected does not
      expect(transportSpy).toHaveBeenCalledOnce();
      expect(reconnectedSpy).not.toHaveBeenCalled();
    });

    it("does not dispatch tavern:transport-open on initial connection", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:transport-open", spy);

      el.dispatchEvent(new Event("htmx:sseOpen"));
      expect(spy).not.toHaveBeenCalled();
    });

    it("ignores htmx:sseOpen on initial connection", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:reconnected", spy);

      el.dispatchEvent(new Event("htmx:sseOpen"));
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("replay gap", () => {
    it("dispatches tavern:replay-gap event by default", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:replay-gap", spy);

      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", {
          detail: { data: "evt-42" },
        }),
      );
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

      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", {
          detail: { data: "evt-42" },
        }),
      );
      expect(reloadSpy).toHaveBeenCalledOnce();
    });

    it("shows banner when gap action is banner", () => {
      const el = createSSEElement({ "data-tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", {
          detail: { data: "evt-42" },
        }),
      );

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

      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", {
          detail: { data: "" },
        }),
      );

      const banner = el.querySelector("[data-tavern-gap-banner]");
      expect(banner.textContent).toBe("Updates missed!");
    });

    it("banner is keyboard-accessible", () => {
      const el = createSSEElement({ "data-tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", { detail: { data: "" } }),
      );

      const banner = el.querySelector("[data-tavern-gap-banner]");
      expect(banner.tagName).toBe("BUTTON");
      expect(banner.getAttribute("type")).toBe("button");
    });

    it("does not create duplicate banners", () => {
      const el = createSSEElement({ "data-tavern-gap-action": "banner" });
      window.Tavern.bind(el);

      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", { detail: { data: "" } }),
      );
      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", { detail: { data: "" } }),
      );

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

      el.dispatchEvent(
        new CustomEvent("tavern-replay-gap", {
          detail: { data: "evt-42" },
        }),
      );
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
      el.dispatchEvent(
        new CustomEvent("tavern-topics-changed", {
          detail: { data: payload },
        }),
      );

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0].detail.added).toEqual(["chat.room1"]);
    });

    it("handles non-JSON payload gracefully", () => {
      const el = createSSEElement();
      window.Tavern.bind(el);

      const spy = vi.fn();
      el.addEventListener("tavern:topics-changed", spy);

      el.dispatchEvent(
        new CustomEvent("tavern-topics-changed", {
          detail: { data: "not json" },
        }),
      );

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
