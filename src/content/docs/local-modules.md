---
title: Local modules
description: Reaching JavaScript from a manifest without writing a plugin — the spellcraft_modules directory, and when to graduate out of it.
part: Part II · Concepts
chapter: 5
order: 8
---

Not every piece of logic deserves a package. `spellcraft_modules/` is the short path: drop a `.js` file in, and its exports are callable from Jsonnet immediately.

## How it works

Every `.js` file in `spellcraft_modules/` is loaded when the frame is constructed, and again before each render. Its exports become native functions, and SpellCraft generates a Jsonnet facade for them at `.spellcraft/modules`, namespaced by filename:

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

That renders:

```json
{
  "name": "my-first-spell",
  "replicas": 3
}
```

The import is literally `"modules"`, and the filename becomes the namespace — `util.js` gives you `modules.util`.

Filenames and export names are quoted on the way into that facade, so anything a filesystem allows works. A `my-utils.js` exporting `get-thing` is reached the way any Jsonnet field with an awkward name is:

```jsonnet
local modules = import "modules";

{ "out.json": { thing: modules["my-utils"]["get-thing"]("id") } }
```

**Parameter** names are the exception, because a parameter cannot be quoted. A function whose parameter is named with a Jsonnet reserved word — `error`, `self`, `local`, `super`, `function`, `assert`, `import` and the rest — is refused when the module loads, naming the export. All of those are ordinary JavaScript identifiers, so this is easier to hit than it sounds; rename the parameter, or give it a different name through the `[fn, 'name']` form, which is checked the same way.

Because the modules are reloaded before each render rather than only at construction, a file edited between two renders on the same frame is picked up.

These files are loaded with `require()`, so they are **CommonJS regardless of your project's `type`**. In a project whose `package.json` sets `"type": "module"`, a `.js` file here fails with *"exports is not defined"* — and SpellCraft only warns, so the manifest then fails later with `field does not exist: util`. Give the file a `.cjs` extension and it still will not load, because only `.js` files are scanned; use `export`-free CommonJS in a `.js` file, or move the logic to a plugin.

## Everything from native functions applies

These are ordinary native functions with a different naming scheme, so the rules in [that chapter](/docs/native-functions.html) hold: arguments must be primitives, results are memoised per argument list, `this` is the shared function context, and the `[fn, 'arg']` form is worth preferring over relying on inference.

<div class="note plain">
<div class="label">Regenerated every run</div>
<p><code>.spellcraft/modules</code> is build output, rewritten before each render and removed again afterwards. The <code>.spellcraft/</code> directory itself stays, because it is on the Jsonnet search path. Don't edit either, and don't commit them — the generated <code>.gitignore</code> already excludes them.</p>
<p>Pass <code>--skip-module-cleanup</code> to <code>generate</code> to keep the aggregate. That is worth knowing for the one failure it exists for: a module that throws while loading is only <em>warned</em> about, so the manifest fails later with <code>field does not exist</code>, and the aggregate is where you can see what the file actually contributed. A failure whose message points <em>into</em> the aggregate keeps it automatically and says so, since the alternative is an error citing a file that no longer exists.</p>
</div>

## When to graduate to a plugin

Local modules are the right tool while logic is specific to one project. Move to a [plugin](/docs/plugin-contract.html) when any of these becomes true:

- **A second project wants it.** Copying `util.js` between repositories is the moment to publish.
- **It needs an init step.** Local modules have no metadata block, so nothing can authenticate or prepare before the first render.
- **It needs to add CLI commands** or file type handlers.
- **It needs to coordinate** with other plugins through events.

The migration is mostly mechanical — `npm init spellcraft-module`, move the functions across, and add the package-name prefix to the `std.native()` calls, which local modules were hiding from you.
