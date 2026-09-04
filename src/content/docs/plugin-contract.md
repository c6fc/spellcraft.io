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
  requires: ['@c6fc/spellcraft-aws-auth'],
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

Async, awaited once before the first render, receiving the frame. Credentials, network calls and subprocess launches belong here rather than at module scope — module scope runs at *load* time, which happens even for `spellcraft --help`.

### `cliExtensions`

Receives the yargs instance and the frame, so a plugin can add commands. This is how `terraform-apply` gets onto the CLI.

## Sharing state between plugins

`functionContext` is the seam. A plugin reuses another's *already initialised* state by reaching for its metadata directly, rather than authenticating a second time:

```js
const { aws } = require('@c6fc/spellcraft-aws-auth')._spellcraft_metadata.functionContext;
```

`spellcraft-aws-terraform` does exactly this to get an authenticated SDK instance from `spellcraft-aws-auth`. Because the object is shared by reference, whatever `aws-auth`'s `init` did — resolving a profile, assuming a role — is already reflected in it.

For ordering rather than state, use [lifecycle events](/docs/lifecycle-events.html).

## Versioning

Declare core as a peer dependency, not a regular one:

```json
{
  "peerDependencies": { "@c6fc/spellcraft": "^1.0.0" },
  "devDependencies": { "@c6fc/spellcraft": "^1.0.0" }
}
```

A regular dependency risks two copies of core in one tree, with plugins registering natives on a frame the CLI is not using. The peer range says what you need; the devDependency is what your own tests run against.
