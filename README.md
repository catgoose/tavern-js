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
     data-tavern-reconnecting-class="opacity-50"
     data-tavern-gap-action="reload">

  <div data-tavern-status class="hidden">
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
<script src="https://cdn.jsdelivr.net/gh/catgoose/tavern-js@v0.0.2/dist/tavern.min.js"></script>
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

## Data Attributes

Configure behavior declaratively on any `sse-connect` element:

| Attribute | Type | Description |
|---|---|---|
| `data-tavern-reconnecting-class` | CSS class(es) | Applied during disconnection, removed on reconnect. Space-separated for multiple classes. |
| `data-tavern-gap-action` | `"reload"` \| `"banner"` \| event name | What to do when a replay gap is detected. `"reload"` refreshes the page. `"banner"` prepends a clickable banner. Anything else dispatches a custom DOM event with that name. |
| `data-tavern-gap-banner-text` | string | Custom text for the gap banner (default: "Connection interrupted. Click to refresh.") |
| `data-tavern-debug` | flag | Enable `console.debug` logging for this element. |

### Status Elements

Any child element with `data-tavern-status` is automatically shown during
disconnection and hidden on reconnect:

```html
<div sse-connect="/sse/feed"
     data-tavern-reconnecting-class="opacity-50">

  <div data-tavern-status class="hidden">
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
| `tavern:replay-gap` | `{ lastEventId }` | Replay log can't satisfy request (only when no `data-tavern-gap-action`) |
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
```

## Dynamic Elements

tavern.js uses a `MutationObserver` to automatically bind to `sse-connect`
elements added after page load. This works with HTMX's `hx-swap`, `hx-boost`,
and any other mechanism that injects HTML into the DOM.

## Examples

### Tailwind reconnection overlay

```html
<div sse-connect="/sse/dashboard"
     sse-swap="update"
     data-tavern-reconnecting-class="opacity-50 pointer-events-none"
     class="relative">

  <div data-tavern-status class="hidden absolute inset-0 flex items-center justify-center bg-white/80">
    <span class="animate-pulse text-gray-500">Reconnecting...</span>
  </div>
</div>
```

### Auto-reload on gap

```html
<div sse-connect="/sse/prices"
     sse-swap="ticker"
     data-tavern-gap-action="reload">
  <!-- Stale price data is worse than a reload -->
</div>
```

### Banner with custom text

```html
<div sse-connect="/sse/chat"
     sse-swap="message"
     data-tavern-gap-action="banner"
     data-tavern-gap-banner-text="You missed some messages. Click to catch up.">
</div>
```

### Custom gap handler via event

```html
<div id="feed"
     sse-connect="/sse/feed"
     sse-swap="post"
     data-tavern-gap-action="feed-stale">
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
     data-tavern-debug>
  <!-- Check the browser console for [tavern] messages -->
</div>
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
