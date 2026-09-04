---
title: Local modules
description: Reaching JavaScript from a manifest without writing a plugin — the spellcraft_modules directory, and when to graduate out of it.
part: Part II · Concepts
chapter: 5
order: 8
---

Not every piece of logic deserves a package. `spellcraft_modules/` is the short path: drop a `.js` file in, and its exports are callable from Jsonnet immediately.

## How it works

Every `.js` file in `spellcraft_modules/` is loaded when the frame is constructed. Its exports become native functions, and SpellCraft generates a Jsonnet facade for them at `.spellcraft/modules`, namespaced by filename:

```js
// spellcraft_modules/util.js
exports.slug = [(text) => (
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
), 'text'];

exports.replicasFor = [(environment) => environment === 'prod' ? 3 : 1, 'environment'];
```

```jsonnet
local modules = import "modules";

{
  "app.json": {
    name: modules.util.slug("My First Spell"),
    replicas: modules.util.replicasFor("prod"),
  },
}
```

The import is literally `"modules"`, and the filename becomes the namespace — `util.js` gives you `modules.util`.

## Everything from native functions applies

These are ordinary native functions with a different naming scheme, so the rules in [that chapter](/docs/native-functions.html) hold: arguments must be primitives, results are memoised per argument list, `this` is the shared function context, and the `[fn, 'arg']` form is worth preferring over relying on inference.

<div class="note plain">
<div class="label">Regenerated every run</div>
<p><code>.spellcraft/</code> is build output, rewritten on each construction and deleted when <code>spellcraft_modules/</code> goes away. Don't edit it, and don't commit it — the generated <code>.gitignore</code> already excludes it.</p>
</div>

## When to graduate to a plugin

Local modules are the right tool while logic is specific to one project. Move to a [plugin](/docs/plugin-contract.html) when any of these becomes true:

- **A second project wants it.** Copying `util.js` between repositories is the moment to publish.
- **It needs an init step.** Local modules have no metadata block, so nothing can authenticate or prepare before the first render.
- **It needs to add CLI commands** or file type handlers.
- **It needs to coordinate** with other plugins through events.

The migration is mostly mechanical — `npm init spellcraft-module`, move the functions across, and add the package-name prefix to the `std.native()` calls, which local modules were hiding from you.
