---
title: SpellFrame API
description: Driving SpellCraft from JavaScript — construction options, the render lifecycle, and the methods plugins and test harnesses use.
part: Part III · Reference
chapter: 2
order: 10
---

`SpellFrame` is the engine. The CLI constructs one and calls three methods on it; anything the CLI can do, your own code can.

```js
import { SpellFrame } from '@c6fc/spellcraft';

const frame = new SpellFrame({ renderPath: './out' });

await frame.init();
await frame.render('manifest.jsonnet');
frame.write();
```

## Construction

```js
new SpellFrame({
  renderPath: './render',
  cleanBeforeRender: true,
  useDefaultFileHandlers: true,
});
```

| Option | Default | Effect |
|---|---|---|
| `baseDir` | `process.cwd()` | Where plugin discovery and Jsonnet imports resolve from |
| `renderPath` | `./render` | Where `write()` puts files |
| `cleanBeforeRender` | `true` | Before writing, delete exactly what the previous `write()` produced |
| `cleanModulesAfterRender` | `true` | Remove the generated `.spellcraft/modules` aggregate once evaluation finishes |
| `useDefaultFileHandlers` | `true` | Register the built-in `.json`, `.yaml`, `.yml`, `.md` and `.txt` serialisers |

`baseDir` is captured per instance rather than when the module was first required, so a frame constructed from a different directory — a test, or anything embedding SpellFrame as a library — resolves against the directory it actually asked for.

The constructor does real work: it discovers and loads plugins and builds the `spellcraft_modules/` facade. Constructing a frame is therefore not free, and it can throw on an ordinary mistake — a `spellcraft_modules` file that will not parse, for instance. An unsatisfied plugin `requires` is *collected* here rather than thrown, so `--help` and `doc` still work on a broken install; `init()` raises it.

## Methods

### `init()`

Runs every plugin's `init` hook in registration order and awaits each. Idempotent: a second call returns immediately. `render()` calls it if you have not.

This is also where an unsatisfied plugin `requires` is raised, before any hook runs — so a failing install stops before a plugin authenticates for a plugin set that was never complete.

### `render(file)`

Evaluates a manifest and returns the resulting object, also storing it on `lastRender`. Sets `activePath` to the file's directory — which is what the built-in `path()` native reports. Emits `render`.

### `renderString(snippet)`

Evaluates a Jsonnet string rather than a file. Useful in tests.

### `write(files = this.lastRender)`

Writes each top-level key of the object to `renderPath`, choosing a serialiser by filename. **Synchronous** — it returns the frame, not a promise. Records what it wrote to `render/.spellcraft/manifest.json`, which is what the next `cleanBeforeRender` pass removes. Emits `write`.

It throws rather than carrying on — on anything that is not an object of filename to content, on a key that resolves outside `renderPath`, and on a file that could not be written. Every key is resolved *before* anything is written or cleaned, so a manifest with a bad key leaves the previous render exactly where it was. A key naming a subdirectory is fine; the directory is created.

### `addNativeFunction(name, fn, ...parameterNames)`

Registers a native function directly, without a plugin. The name is used verbatim — no namespace is added — so prefix it yourself.

### `addFileTypeHandler(pattern, handler)`

Registers a serialiser. `pattern` is a regular-expression **source string**, matched against the filename.

### `addExternalCode(name, value)`

Exposes a value to Jsonnet's `std.extVar(name)`. Non-strings are JSON-stringified for you; a **string is passed through as Jsonnet code**, so a bare `'prod'` is read as a variable reference and fails. Pass `JSON.stringify('prod')` to mean the string.

### `loadPlugin(packageName, jsMainPath)`

Loads a plugin from an explicit path, registering its natives as `packageName:export`. This is how a plugin's own test harness loads the package it lives in — automatic discovery only finds *dependencies*, never the current package.

Loading is deduplicated on the entry point's resolved real path, not on the name, so a package reached under two names — installed under an npm alias, say — is extended into the frame once. Its natives are registered under both names, since the alias is what a manifest author types while the package's own `module.libsonnet` hardcodes the real one.

```js
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

frame.loadPlugin(pkg.name, path.resolve(pkg.main));
```

## Properties

| Property | Description |
|---|---|
| `lastRender` | The most recent evaluated object |
| `activePath` | Directory of the manifest last rendered |
| `functionContext` | Shared `this` for native functions; contains `spellframe` |
| `loadedPlugins` | `Map` of package name to `{ name, requires }` |
| `cliExtensions` | Array of functions contributed by plugins |
| `fileTypeHandlers` | Pattern-to-serialiser map |
| `isInitialized` | Whether `init()` has run |

## Events

`SpellFrame` extends `EventEmitter`. Beyond `render` and `write`, every native function emits under its registered name when it actually executes. `emitAsync(event, ...args)` awaits each listener in turn — see [Lifecycle events](/docs/lifecycle-events.html).

<div class="note plain">
<div class="label">Reusing a frame</div>
<p>The native-function cache is cleared at the start of each evaluation, so a frame that renders twice asks its APIs again the second time rather than replaying the first render's answers. Within one render the cache is load-bearing and stays — that is what keeps <code>getCallerIdentity()</code> at one request no matter how many call sites read it.</p>
<p>Renders in one process are also fully serialised, including the <code>init()</code> that precedes each: plugins keep state at module scope, so two overlapping renders could otherwise contaminate each other.</p>
</div>
