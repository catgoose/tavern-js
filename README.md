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
<script src="https://cdn.jsdelivr.net/gh/catgoose/tavern-js@v0.0.17/dist/tavern.min.js"></script>
```

**Direct download:** Grab `dist/tavern.min.js` from the
[latest release](https://github.com/catgoose/tavern-js/releases/latest).

**Vendor it:**

```bash
curl -Lso public/js/tavern.min.js https://cdn.jsdelivr.net/gh/catgoose/tavern-js@latest/dist/tavern.min.js
```

## How It Works

Tavern.js auto-discovers elements with `sse-connect` (HTMX SSE extension)
and listens for four control events that the tavern broker already emits:

| Server Event | What Happened | tavern.js Response |
|---|---|---|
| `tavern-reconnected` | Replay-complete signal — fires AFTER replay finishes (JSON: `replayDelivered`, `replayDropped`) | Remove reconnecting class, hide status, dispatch `tavern:reconnected` with replay stats |
| `tavern-replay-gap` | Replay log can't cover the gap (JSON: `lastEventId`) | Reload, show banner, or fire custom event |
| `tavern-replay-truncated` | Replay was truncated due to limits (JSON: `delivered`, `dropped`) | Dispatch `tavern:replay-truncated` with truncation stats |
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
| `tavern-hot-policy` | space-separated keywords | Interaction protection policies: `pause-on-pointerdown`, `defer-on-focus`. See [Hot-Region Interaction Protection](#hot-region-interaction-protection). |

### Stale / Live Region State

> Part of the [interaction insulation](#interaction-insulation) pattern —
> provides the delivery truth layer.

Beyond binary connected/disconnected, tavern.js tracks granular region
state so the UI can reflect intermediate conditions like recovery and
staleness.

**State machine:**

```
LIVE → (sseError) → DISCONNECTED → (sseOpen) → RECOVERING → (tavern-reconnected) → LIVE
LIVE → (replay-gap without reload) → STALE
RECOVERING → (replay-gap) → STALE
STALE → (tavern-reconnected) → LIVE
```

| Attribute | Type | Description |
|---|---|---|
| `tavern-stale-class` | CSS class(es) | Applied when the region becomes stale. Removed when region goes live. |
| `tavern-live-class` | CSS class(es) | Applied when the region is live. Removed when region goes stale or disconnects. |

| Status attribute | Shown when | Hidden when |
|---|---|---|
| `tavern-status-live` | Region is live | Stale, disconnected, or recovering |
| `tavern-status-stale` | Region is stale | Live, disconnected, or recovering |
| `tavern-status-recovering` | Transport open, awaiting server confirmation | Live, stale, or disconnected |

```html
<div sse-connect="/sse/feed"
     sse-swap="post"
     tavern-stale-class="opacity-50"
     tavern-live-class="opacity-100">
  <span tavern-status-live>Live</span>
  <span tavern-status-stale class="hidden">Stale — waiting for recovery</span>
  <span tavern-status-recovering class="hidden">Reconnecting…</span>
</div>
```

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
| `tavern:reconnected` | `{ replayDelivered, replayDropped }` | Server confirmed reconnection (emitted after replay completes) |
| `tavern:replay-gap` | `{ lastEventId }` | Replay log can't satisfy request (only when no `tavern-gap-action`) |
| `tavern:replay-truncated` | `{ delivered, dropped }` | Replay was truncated — some events were dropped due to limits |
| `tavern:topics-changed` | parsed JSON payload | Topic subscriptions changed |
| `tavern:stale` | `{ reason }` | Region entered stale state (e.g. replay gap without reload) |
| `tavern:live` | — | Region is fully live again |
| `tavern:recovering` | — | Transport open, recovery in progress |

```javascript
document.addEventListener("tavern:disconnected", (e) => {
  console.log("Lost connection on", e.target);
});

document.addEventListener("tavern:reconnected", (e) => {
  console.log("Reconnected — delivered:", e.detail.replayDelivered,
              "dropped:", e.detail.replayDropped);
});

document.addEventListener("tavern:replay-gap", (e) => {
  console.log("Missed messages since", e.detail.lastEventId);
  // Custom recovery logic here
});

document.addEventListener("tavern:replay-truncated", (e) => {
  console.log("Replay truncated — delivered:", e.detail.delivered,
              "dropped:", e.detail.dropped);
});
```

Use the structured detail for defensive recovery logic:

```javascript
document.addEventListener("tavern:reconnected", (e) => {
  if (e.detail.replayDropped > 0) {
    console.warn("Some messages were lost during reconnection");
  }
});

document.addEventListener("tavern:replay-truncated", (e) => {
  console.warn(`Replay truncated: ${e.detail.delivered} delivered, ${e.detail.dropped} dropped`);
});
```

All control events from the tavern broker now use structured JSON payloads.
tavern.js parses these automatically and exposes the data as `detail` on the
corresponding DOM events. Malformed or empty payloads are handled gracefully
(detail defaults to an empty object).

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

## Delegated Commands

> Part of the [interaction insulation](#interaction-insulation) pattern —
> provides the intent capture layer.

For common cases where every interactive element in a hot region follows the
same pattern (click a button, POST to its URL, send its data attributes),
tavern.js offers a fully declarative alternative — no JavaScript required.

Add attributes to the stable `sse-connect` parent:

| Attribute | Description |
|---|---|
| `tavern-command-delegate` | Event type to listen for (e.g. `"click"`, `"pointerdown"`) |
| `tavern-command-target` | CSS selector passed to `closest()` on the event target |
| `tavern-command-dedup` | Dedup window in milliseconds — suppresses duplicate commands to the same URL within the window |

Each matching child carries its own `command-url` (the POST endpoint) and any
number of `command-*` data attributes that become the JSON body:

```html
<div id="task-list"
     sse-connect="/sse/tasks"
     sse-swap="tasks"
     tavern-command-delegate="click"
     tavern-command-target="[command-url]">

  <!-- Rendered by SSE — buttons are ephemeral -->
  <button command-url="/tasks/complete" command-id="42">Done</button>
  <button command-url="/tasks/delete"   command-id="42">Remove</button>
</div>
```

When the user clicks a button:

1. `closest("[command-url]")` finds the nearest matching element
2. `command-url` is read as the POST endpoint
3. `{name}` tokens in the URL are expanded (see [URL Token Expansion](#url-token-expansion))
4. All other `command-*` attributes become the JSON body (`command-id="42"` becomes `{ "id": "42" }`)
5. `Tavern.command(url, body)` is called automatically

### `pointerdown` for Hot Regions

In aggressively SSE-swapped regions, `click` can fire too late — the target
element may be replaced between `pointerdown` and `click`. Use
`tavern-command-delegate="pointerdown"` to capture intent immediately:

```html
<div sse-connect="/sse/tasks"
     sse-swap="tasks"
     tavern-command-delegate="pointerdown"
     tavern-command-target="[command-url]"
     tavern-command-dedup="500">
  <button command-url="/tasks/{id}/complete" command-id="42">Done</button>
</div>
```

When `delegate` is `"pointerdown"`, tavern also listens for `click` on the
same container. Combined with `tavern-command-dedup`, the follow-up `click`
is automatically suppressed — no double-fire.

### Dedup Window

Set `tavern-command-dedup="500"` (milliseconds) on the parent to suppress
duplicate commands to the same URL within the window. This is useful when
`pointerdown` and `click` both fire on the same target, or when rapid taps
could send multiple POSTs.

When dedup is active, after a command fires the URL and timestamp are recorded
on the matched element. Any subsequent command to the same URL within the
window is silently suppressed.

### URL Token Expansion

`command-url` supports `{name}` tokens that are expanded from attributes on
the matched element. This avoids repeating the base URL path on every button:

```html
<button command-url="/tasks/{id}/complete" command-id="42">Done</button>
<!-- Resolves to POST /tasks/42/complete -->
```

**Token resolution order:**
1. `command-name` attribute (e.g. `command-id` for `{id}`)
2. `data-name` attribute (e.g. `data-id`)
3. Raw `name` attribute (e.g. `id`)

Unresolved tokens are left as-is in the URL.

### Hot-Region Example

Combining `pointerdown`, dedup, and URL expansion for a high-frequency
SSE region:

```html
<div sse-connect="/sse/tasks"
     sse-swap="tasks"
     tavern-command-delegate="pointerdown"
     tavern-command-target="[command-url]"
     tavern-command-dedup="500"
     tavern-hot-policy="pause-on-pointerdown">

  <!-- Buttons are ephemeral — replaced on every SSE swap -->
  <button command-url="/tasks/{id}/complete" command-id="42">Done</button>
  <button command-url="/tasks/{id}/archive"  command-id="42">Archive</button>
  <button command-url="/tasks/{id}/delete"   command-id="42">Remove</button>
</div>
```

- `pointerdown` captures intent before the DOM can churn
- `dedup="500"` prevents the follow-up `click` from double-firing
- `{id}` tokens expand from `command-id` on each button
- `pause-on-pointerdown` holds SSE swaps while the pointer is down

### Delegated Command Events

| Event | Dispatched on | `detail` | When |
|---|---|---|---|
| `tavern:command-sent` | matched element | `{ url, body }` | Immediately before the POST |
| `tavern:command-success` | matched element | `{ url, body, response }` | POST returned 2xx |
| `tavern:command-error` | matched element | `{ url, body, error }` | POST failed or returned non-2xx |

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

## Hot-Region Interaction Protection

> Part of the [interaction insulation](#interaction-insulation) pattern —
> provides the interaction safety layer.

SSE-driven DOM regions update rapidly, which can disrupt user interactions
like dragging, selecting, or typing. `tavern-hot-policy` pauses incoming
SSE swaps while the user is interacting, preventing the DOM from shifting
under their hands.

```html
<div sse-connect="/sse/tasks"
     sse-swap="tasks"
     tavern-hot-policy="pause-on-pointerdown defer-on-focus">
</div>
```

### Policies

| Keyword | Trigger | Effect |
|---|---|---|
| `pause-on-pointerdown` | `pointerdown` inside the region | Queues SSE swaps until `pointerup` / `pointercancel` |
| `defer-on-focus` | `focusin` on a child element | Queues SSE swaps until focus leaves the region entirely |

Multiple policies can be combined (space-separated). If any policy is
active, swaps are suppressed. Swaps resume only when all policies
deactivate.

### How it works

When a policy is active, tavern intercepts `htmx:sseBeforeMessage` events
via `preventDefault()` and queues the message data. The queue deduplicates
by SSE event type (only the last message per type is kept). When the
interaction ends, the queue is discarded — the next natural SSE message
will bring current state.

### Events

| Event | `detail` | When |
|---|---|---|
| `tavern:policy-activated` | `{ policy }` | A policy begins suppressing swaps |
| `tavern:policy-deactivated` | `{ policy, flushed }` | A policy stops; `flushed` is the number of queued messages that were discarded |

```javascript
document.addEventListener("tavern:policy-activated", (e) => {
  console.log("Pausing swaps:", e.detail.policy);
});

document.addEventListener("tavern:policy-deactivated", (e) => {
  console.log("Resumed swaps:", e.detail.policy, "discarded:", e.detail.flushed);
});
```

### Data attributes

| Attribute | Type | Description |
|---|---|---|
| `tavern-hot-policy` | space-separated keywords | Policies to apply. Unknown keywords are ignored with a console warning. |

## Interaction Insulation

> Interaction insulation is the stable boundary around a hot SSE-driven DOM
> region. The interior is volatile — replaced by server-sent swaps. The
> exterior captures user intent, enforces interaction policies, and surfaces
> delivery state.

### When you need it

- The region receives frequent SSE swaps (multiple per second)
- Users interact with elements inside the region (clicks, inputs, selections)
- Node-bound handlers (`hx-post`, `onclick`) break because targets are replaced between events

### When you don't

- The region updates infrequently
- The DOM is stable between user interactions
- Standard HTMX attributes work reliably

### How tavern-js provides it

| Layer | Feature | Attributes |
|---|---|---|
| Intent capture | [Delegated commands](#delegated-commands) | `tavern-command-delegate`, `tavern-command-target` |
| Interaction safety | [Hot-region policies](#hot-region-interaction-protection) | `tavern-hot-policy` |
| Delivery truth | [Stale/live state](#stale--live-region-state) | `tavern-stale-class`, `tavern-live-class`, status elements |

### Example — a fully insulated hot region

```html
<div id="task-list"
     sse-connect="/sse/tasks"
     sse-swap="tasks"
     tavern-command-delegate="click"
     tavern-command-target="[command-url]"
     tavern-hot-policy="pause-on-pointerdown defer-on-focus"
     tavern-stale-class="opacity-50"
     tavern-live-class="opacity-100"
     tavern-reconnecting-class="animate-pulse">
  <span tavern-status-recovering class="hidden">Reconnecting…</span>
  <span tavern-status-stale class="hidden">Stale</span>
  <!-- Interior: volatile, server-driven -->
  <button command-url="/tasks/complete" command-id="42">Done</button>
</div>
```

### The boundary rule

The `sse-connect` element is the insulation boundary. All `tavern-*`
attributes go on it. Interior elements are ephemeral — they carry only
`command-*` data attributes that the insulation layer reads.

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
