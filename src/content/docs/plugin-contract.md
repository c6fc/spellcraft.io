---
title: The plugin contract
description: What makes an npm package a SpellCraft plugin, every field of the metadata block, and how plugins share state with one another.
part: Part II · Concepts
chapter: 3
order: 6
---

A SpellCraft plugin is an ordinary npm package with `"spellcraft": true` in its `package.json`. That flag is the entire registration mechanism.

## Discovery

At construction, SpellCraft walks the dependency tree of the project you are running in, resolving each dependency the way Node would and loading any package carrying the flag. It recurses, so a plugin that depends on another plugin brings it along.

Two consequences:

- **Installing is enough.** There is no config file listing plugins, and no import needed on the JavaScript side.
- **It is your project's tree that matters.** A plugin installed beside SpellCraft rather than beside your manifest will not be found.

## Anatomy

```
your-plugin/
├── module.js          the JavaScript half — natives and metadata
├── module.libsonnet   the Jsonnet half — what users import
├── test.jsonnet       exercises everything the module exposes
└── package.json       "main": "module.js", "spellcraft": true
```

`module.libsonnet` is hand-written, not generated. That is deliberate: it is where a plugin turns low-level natives into declarative helpers worth importing. Keeping it in step with `module.js` is the author's job.

The fastest start is the generator, which produces all of the above with tests that pass immediately:

```bash
npm init spellcraft-module my-plugin
```

## The metadata block

Every field is optional.

```js
exports._spellcraft_metadata = {
  requires: ['@you/some-other-plugin'],
  functionContext: { environment: 'dev' },
  fileTypeHandlers: { '.*?\\.env$': (content) => renderDotenv(content) },
  init: async (spellframe) => { /* runs once, before the first render */ },
  cliExtensions: (yargs, spellframe) => { /* add commands */ },
};
```

### `requires`

Package names of plugins whose native functions you call. SpellCraft refuses to start if one is missing, so a forgotten dependency produces a clear message naming the package instead of a Jsonnet runtime error pointing at whoever called you.

### `functionContext`

An object merged into the shared `this` for every native function in **every** loaded plugin. It always contains `spellframe`, the frame itself.

### `fileTypeHandlers`

A map of regular-expression source strings to serialisers, consulted when writing output. Remember these are JavaScript strings, so a literal dot needs `\\.`.

### `init`

Async, awaited once before the first render, receiving the frame. Anything you would otherwise do at module scope belongs here instead — module scope runs at *load* time, which happens even for `spellcraft --help`.

Write it so that running it twice is harmless. "Once" is what SpellCraft aims for and what it delivers for an ordinary install, but it is not a guarantee the contract makes: a frame can be reused, and a plugin reached under two names — installed under an npm alias, say — is one package that two names point at. Memoise anything that allocates, appends, spawns or counts, the way the auth nodes below memoise their credential resolution.

Be careful what you put in it, though: SpellCraft runs the `init` of **every loaded plugin**, whether or not the manifest ends up using that plugin. Cheap, unconditional work belongs here — reading a config file, registering an event listener. Anything that can fail for reasons the spell does not care about, and anything expensive, does not: resolve it on first use instead, memoised.

This is why the auth nodes of `@c6fc/spellcraft-plugins` have no `init` hook at all. A spell that touches only AWS must not authenticate to GCP, and a GCP credential failure must not be fatal to a render that never asked GCP anything — so each node resolves credentials on its first native call and memoises the result:

```js
let authPromise = null;
const ensureAuth = () => (authPromise ??= resolveCredentials());

exports.getCallerIdentity = [async () => {
  await ensureAuth();
  return identity;
}];
```

The same rule applies one level out: **your entry point must be side-effect-free at `require()` time, and that includes what it requires.** Discovery loads every installed plugin's main, so a dependency that does work at *its* module scope does that work on every command — you have simply moved the cost somewhere it is harder to see.

This is easy to miss, because the offending line is in someone else's package and looks entirely ordinary in yours. A dependency that installs a binary, reads a config file or opens a connection at *its* module scope does all of that every time `spellcraft --help` runs, in every project that has your plugin installed. Require it lazily, which is the same shape as the memoisation above applied to the import itself:

```js
let tf = null;
const terraform = () => (tf ??= require("@c6fc/terraform"));
```

### `cliExtensions`

Receives the yargs instance and the frame, so a plugin can add commands. This is how `terraform-apply` gets onto the CLI.

A command handler decides for itself whether it needs `spellframe.init()`. Calling it runs **every** loaded plugin's `init`, not just yours, so reach for it when your command is about to render — and not when your command only needs your own node's state. The three identity commands in `@c6fc/spellcraft-plugins` call their own memoised `ensureAuth()` and never call `init()`; `terraform-apply` renders, so it does.

## Sharing state between plugins

`functionContext` is the seam. A plugin reuses another's *already initialised* state by reaching for its metadata directly, rather than authenticating a second time:

```js
const { aws } = require('@you/their-plugin')._spellcraft_metadata.functionContext;
```

Because the object is shared by reference, whatever the other plugin did to it — resolving a profile, assuming a role — is already reflected in what you get.

This is worth knowing for what it implies. Two plugins that share state this way are not independently versionable, whatever their `package.json` files claim: one reaches into the other's internals, so they have to be released together and tested together. That is why the official nodes — which do exactly this, the terraform nodes reading the auth nodes' resolved credentials — ship as one package rather than several. Reach for `functionContext` across a package boundary when the alternative is authenticating twice, and ship the two together when you do.

For ordering rather than state, use [lifecycle events](/docs/lifecycle-events.html).

## Versioning

Declare core as a peer dependency, not a regular one:

```json
{
  "peerDependencies": { "@c6fc/spellcraft": "^2.0.0" },
  "devDependencies": { "@c6fc/spellcraft": "^2.0.0" }
}
```

A regular dependency risks two copies of core in one tree, with plugins registering natives on a frame the CLI is not using. The peer range says what you need; the devDependency is what your own tests run against.
