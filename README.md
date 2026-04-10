# tavern-js

Client-side companion for the [tavern](https://github.com/catgoose/tavern)
SSE pub/sub engine. Declarative UI behaviors for connection state, replay
gaps, and topic changes.

![tavern-js](https://raw.githubusercontent.com/catgoose/screenshots/main/tavern-js/tavern-js.png)

## Why?

Tavern is incredibly smart on the server — adaptive backpressure, replay
gaps, reconnection bundling, circuit breakers. But the browser is blind.
Native `EventSource` reconnects silently. The user sees stale data and has
no idea something went wrong.

**Before** (what users write today):

```html
<div id="notifications" sse-connect="/sse/notifications" sse-swap="message">
  <!-- Works, but... -->
  <!-- No idea when we disconnected -->
  <!-- No idea when we reconnected -->
  <!-- No idea if we missed messages -->
  <!-- User stares at stale data not knowing something is wrong -->
</div>
```

**After** (with tavern.js):

```html
<script src="https://cdn.jsdelivr.net/gh/catgoose/tavern-js@latest/dist/tavern.min.js"></script>
<div id="notifications"
     sse-connect="/sse/notifications"
     sse-swap="message"
     tavern-reconnecting-class="opacity-50"
     tavern-gap-action="reload">

  <div tavern-status class="hidden">
    Reconnecting...
  </div>
</div>
```

That's it. No custom JavaScript. Tavern already knows when things go wrong —
`tavern.js` tells the user.

## Install

**CDN (jsdelivr):**

```html
<script src="https://cdn.jsdelivr.net/gh/catgoose/tavern-js@latest/dist/tavern.min.js"></script>
```

Pin to a specific version:

```html
<script src="https://cdn.jsdelivr.net/gh/catgoose/tavern-js@v0.0.14/dist/tavern.min.js"></script>
```

**Direct download:** Grab `dist/tavern.min.js` from the
[latest release](https://github.com/catgoose/tavern-js/releases/latest).

**Vendor it:**

```bash
curl -Lso public/js/tavern.min.js https://cdn.jsdelivr.net/gh/catgoose/tavern-js@latest/dist/tavern.min.js
```

## How It Works

Tavern.js auto-discovers elements with `sse-connect` (HTMX SSE extension)
and listens for three control events that the tavern broker already emits:

| Server Event | What Happened | tavern.js Response |
|---|---|---|
| `tavern-reconnected` | Client reconnected after a drop | Remove reconnecting class, hide status |
| `tavern-replay-gap` | Replay log can't cover the gap | Reload, show banner, or fire custom event |
| `tavern-topics-changed` | Subscription set changed at runtime | Dispatch DOM event with topic details |

Connection drops are detected via HTMX lifecycle events (`htmx:sseError` /
`htmx:sseOpen`) so the UI reacts immediately — before the server even knows.

## Attributes

Configure behavior declaratively on any `sse-connect` element:

| Attribute | Type | Description |
|---|---|---|
| `tavern-reconnecting-class` | CSS class(es) | Applied during disconnection, removed on reconnect. Space-separated for multiple classes. |
| `tavern-gap-action` | `"reload"` \| `"banner"` \| event name | What to do when a replay gap is detected. `"reload"` refreshes the page. `"banner"` prepends a clickable banner. Anything else dispatches a custom DOM event with that name. |
| `tavern-gap-banner-text` | string | Custom text for the gap banner (default: "Connection interrupted. Click to refresh.") |
| `tavern-debug` | flag | Enable `console.debug` logging for this element. |

### Status Elements

Any child element with `tavern-status` is automatically shown during
disconnection and hidden on reconnect:

```html
<div sse-connect="/sse/feed"
     tavern-reconnecting-class="opacity-50">

  <div tavern-status class="hidden">
    <span class="animate-pulse">Reconnecting...</span>
  </div>

  <!-- Normal SSE content renders here -->
</div>
```

## DOM Events

tavern.js dispatches bubbling custom events for programmatic handling:

| Event | `detail` | When |
|---|---|---|
| `tavern:disconnected` | — | SSE connection dropped |
| `tavern:reconnected` | — | Server confirmed reconnection |
| `tavern:replay-gap` | `{ lastEventId }` | Replay log can't satisfy request (only when no `tavern-gap-action`) |
| `tavern:topics-changed` | parsed JSON payload | Topic subscriptions changed |

```javascript
document.addEventListener("tavern:disconnected", (e) => {
  console.log("Lost connection on", e.target);
});

document.addEventListener("tavern:replay-gap", (e) => {
  console.log("Missed messages since", e.detail.lastEventId);
  // Custom recovery logic here
});
```

## Commands

Some Tavern-driven interfaces update so rapidly over SSE that interactive
elements inside the update region can be replaced while the user is clicking
them. In these "hot" DOM regions, node-bound actions like `hx-post` or
element-scoped click listeners become unreliable because the target element
may be gone before the browser dispatches the event.

`Tavern.command()` provides a stable way to POST intent to the server from
these volatile regions. The server processes the command and publishes any
resulting UI update back over SSE as usual.

**When to use:** Use `Tavern.command()` when interactions target elements
inside high-frequency SSE regions. Normal forms and `hx-post` remain
preferred outside hotspots.

### API

```javascript
Tavern.command(url, body?, options?)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — | The endpoint to POST to |
| `body` | `Object` | `{}` | JSON-serializable request body |
| `options.headers` | `Object` | — | Additional headers (merged with `Content-Type: application/json`) |
| `options.signal` | `AbortSignal` | — | AbortSignal for cancellation |
| `options.credentials` | `string` | — | Fetch credentials mode |

Returns a `Promise<Response>` that resolves on 2xx and rejects on non-2xx,
network failure, or aborted request.

### Example

```html
<!-- The list re-renders rapidly via SSE — buttons inside it are ephemeral -->
<div id="task-list"
     sse-connect="/sse/tasks"
     sse-swap="tasks">
  <!-- Rendered by SSE: <button data-action="complete" data-id="42">Done</button> -->
</div>

<script>
  // Delegate clicks on a stable parent — the buttons themselves are volatile
  document.getElementById("task-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action='complete']");
    if (!btn) return;
    Tavern.command("/tasks/complete", { id: btn.dataset.id });
  });
</script>
```

The server answers with ordinary HTTP success/error. The UI update arrives
separately via SSE — `Tavern.command()` does not assume the response body
contains UI state.

> **Note:** `Tavern.command()` is an escape hatch for hotspot interactions,
> not a replacement for normal forms or `hx-post`.

## Programmatic API

tavern.js auto-initializes when the DOM is ready — you do not need to call
`init()` unless you want to re-scan after removing the observer.

`window.Tavern` exposes:

```javascript
// Bind tavern listeners to a specific element
Tavern.bind(document.getElementById("my-sse-element"));

// Re-scan the entire document for new sse-connect elements
Tavern.scanAndBind();

// Full initialization (scan + start MutationObserver)
// Idempotent — safe to call multiple times
Tavern.init();

// Tear down: disconnect observer and reset state
Tavern.destroy();

// Send a command POST to an application endpoint
Tavern.command("/endpoint", { key: "value" }, { credentials: "include" });
```

## Dynamic Elements

tavern.js uses a `MutationObserver` to automatically bind to `sse-connect`
elements added after page load. This works with HTMX's `hx-swap`, `hx-boost`,
and any other mechanism that injects HTML into the DOM.

## App Shell & Lifeline Connections

Modern SPAs and HTMX-driven apps often have a persistent "shell" (sidebar,
header, global notifications) alongside content areas that change on
navigation. Tavern supports this pattern with **lifeline connections** and
**scoped streams**.

A **lifeline** is your always-on SSE connection — it powers global UI like
notifications, presence indicators, or system alerts. It stays connected
regardless of what happens in the content area.

A **scoped stream** is a secondary SSE connection tied to a specific page or
feature. When the user navigates away, the scoped stream is retired. If a
scoped stream fails, the lifeline remains unaffected, and a fallback event
is dispatched so the app can degrade gracefully.

### When to use a scoped stream

Use the **lifeline** for events that matter everywhere: notifications, auth
status, system alerts. Use a **scoped stream** for events tied to a specific
view: a chat room, a live dashboard, a collaborative editor. The scoped
stream can be added when the user enters that view and retired when they
leave.

### Data attributes

| Attribute | Values | Description |
|---|---|---|
| `tavern-role` | `"lifeline"` \| `"scoped"` | Marks the connection role. Only one lifeline is allowed per page. |
| `tavern-scope` | string | Names a scoped stream for coordination (required when role is "scoped"). |

### Stream lifecycle events

Scoped streams move through a lifecycle: `warming` -> `ready` -> `active` -> `retired`.

| Event | Dispatched on | `detail` | When |
|---|---|---|---|
| `tavern:stream-warming` | scoped element | `{ scope }` | Stream registered, waiting for SSE connection |
| `tavern:stream-ready` | scoped element | `{ scope }` | SSE connection established (htmx:sseOpen) |
| `tavern:stream-promoted` | scoped element | `{ scope }` | Stream promoted to active via `Tavern.promote()` |
| `tavern:stream-retired` | scoped element | `{ scope }` | Stream retired via `Tavern.retire()` |
| `tavern:stream-fallback` | lifeline element | `{ scope }` | Active scoped stream errored — app should fall back to lifeline |

### Lifeline & stream API

```javascript
// Get the lifeline element (or null)
Tavern.lifeline();

// Get info about a scoped stream: { el, state } or null
Tavern.stream("chat");

// Get all registered streams
Tavern.streams();

// Promote a scoped stream to "active" (enables fallback-to-lifeline on error)
Tavern.promote("chat");

// Retire a scoped stream (removes it from the registry)
Tavern.retire("chat");
```

## Examples

### Tailwind reconnection overlay

```html
<div sse-connect="/sse/dashboard"
     sse-swap="update"
     tavern-reconnecting-class="opacity-50 pointer-events-none"
     class="relative">

  <div tavern-status class="hidden absolute inset-0 flex items-center justify-center bg-white/80">
    <span class="animate-pulse text-gray-500">Reconnecting...</span>
  </div>
</div>
```

### Auto-reload on gap

```html
<div sse-connect="/sse/prices"
     sse-swap="ticker"
     tavern-gap-action="reload">
  <!-- Stale price data is worse than a reload -->
</div>
```

### Banner with custom text

```html
<div sse-connect="/sse/chat"
     sse-swap="message"
     tavern-gap-action="banner"
     tavern-gap-banner-text="You missed some messages. Click to catch up.">
</div>
```

### Custom gap handler via event

```html
<div id="feed"
     sse-connect="/sse/feed"
     sse-swap="post"
     tavern-gap-action="feed-stale">
</div>

<script>
  document.getElementById("feed").addEventListener("feed-stale", (e) => {
    // Trigger an HTMX request to fetch the full feed
    htmx.trigger("#feed", "htmx:load");
  });
</script>
```

### Debug mode

```html
<div sse-connect="/sse/debug"
     tavern-debug>
  <!-- Check the browser console for [tavern] messages -->
</div>
```

### App shell with lifeline + scoped stream

```html
<!-- Persistent lifeline — stays connected across navigations -->
<div sse-connect="/sse/global"
     sse-swap="notification"
     tavern-role="lifeline"
     tavern-reconnecting-class="opacity-50">
  <div tavern-status class="hidden">Reconnecting...</div>
</div>

<!-- Scoped stream — tied to the current page -->
<div id="chat-stream"
     sse-connect="/sse/chat/room1"
     sse-swap="message"
     tavern-role="scoped"
     tavern-scope="chat">
</div>
```

### Stream promotion on navigation

```html
<script>
  // When the chat view loads, promote the scoped stream
  document.getElementById("chat-stream")
    .addEventListener("tavern:stream-ready", () => {
      Tavern.promote("chat");
    });

  // When navigating away, retire the scoped stream
  document.body.addEventListener("htmx:beforeSwap", (e) => {
    if (Tavern.stream("chat")) {
      Tavern.retire("chat");
    }
  });
</script>
```

### Handling fallback to lifeline

```html
<script>
  // Listen on the lifeline for scoped stream failures
  document.querySelector("[tavern-role='lifeline']")
    .addEventListener("tavern:stream-fallback", (e) => {
      console.log("Scoped stream failed:", e.detail.scope);
      // Show a degraded UI or retry logic
    });
</script>
```

## Development

```bash
npm install
npm run lint      # oxlint
npm test          # vitest
npm run build     # esbuild → dist/tavern.min.js
npm run check     # all three
```

## License

MIT
