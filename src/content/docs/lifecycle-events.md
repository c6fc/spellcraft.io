---
title: Lifecycle events
description: How plugins coordinate — the SpellFrame event emitter, the pre-apply handshake, and the bootstrapping problem it solves.
part: Part II · Concepts
chapter: 4
order: 7
---

`SpellFrame` extends Node's `EventEmitter`. Plugins announce phases on it and listen for each other's, which is how work gets ordered between plugins that know nothing about one another — including ones you did not write.

## The problem this solves

Terraform cannot enable the API that a resource it is creating depends on. Enabling `compute.googleapis.com` and creating a Compute instance in one apply is a race the apply loses, because the provider needs the API live before it can plan against it.

The usual answer is a README that says *"first, run this."* That step gets skipped, or run against the wrong project, or forgotten entirely on the second environment.

## The handshake

The `terraform` node owns the Terraform lifecycle and announces itself before applying:

```js
await spellframe.emitAsync('@c6fc/spellcraft-plugins:terraform.pre-apply');
```

The `gcp.terraform` node — which the `terraform` node has no reference to, and would work identically if it lived in someone else's package — listens:

```js
exports._spellcraft_metadata = {
  init: async (spellframe) => {
    spellframe.on('@c6fc/spellcraft-plugins:terraform.pre-apply', async () => {
      await flushPendingServices();
    });
  },
};
```

Meanwhile, anything in the manifest that needs a GCP service registers it during evaluation. By the time `pre-apply` fires, the registry holds every service the rendered configuration will need, and one call enables them all before Terraform starts.

Step zero became part of the program.

## Emitting and awaiting

`emit()` is Node's ordinary synchronous emit: it does not wait for async listeners. For anything a listener must finish before you continue, use `emitAsync()`, which awaits each listener in turn:

```js
await spellframe.emitAsync('@you/your-plugin:pre-flight', context);
```

Listeners run sequentially, in registration order. If one throws, the emit rejects and the error propagates to whoever triggered the phase — which is usually what you want for a bootstrap step.

## Naming

Namespace events with your package name, exactly like native functions:

```
@c6fc/spellcraft-plugins:terraform.pre-apply
```

An unprefixed `pre-apply` is a collision waiting for the second plugin that has a notion of applying.

## Built-in events

The frame emits two of its own:

| Event | When | Argument |
|---|---|---|
| `render` | after a manifest evaluates | the rendered object |
| `write` | after files are written | the object that was written |

Every native function also emits an event under its own registered name when it is called.

<div class="note plain">
<div class="label">Events and memoisation</div>
<p>The event is emitted <em>before</em> the memoisation check, so it fires on every call — including the ones served from cache. The function body still runs once per <code>(name, arguments)</code>. So the event counts call sites, and the <a href="/docs/native-functions.html">cache</a> decides how much work each one costs.</p>
</div>

## Registering listeners

Register in `init`, not at module scope. At module scope you have no frame to listen to; `init` receives one and runs once, before any render.
