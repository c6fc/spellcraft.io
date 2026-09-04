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
| `renderPath` | `./render` | Where `write()` puts files |
| `cleanBeforeRender` | `true` | Delete matching files in `renderPath` before writing |
| `useDefaultFileHandlers` | `true` | Register the built-in JSON and YAML serialisers |

The constructor does real work: it discovers and loads plugins, validates their `requires`, and builds the `spellcraft_modules/` facade. Constructing a frame is therefore not free, and it can throw — a missing plugin dependency surfaces here.

## Methods

### `init()`

Runs every plugin's `init` hook in registration order and awaits each. Idempotent: a second call returns immediately. `render()` calls it if you have not.

### `render(file)`

Evaluates a manifest and returns the resulting object, also storing it on `lastRender`. Sets `activePath` to the file's directory — which is what the built-in `path()` native reports. Emits `render`.

### `renderString(snippet)`

Evaluates a Jsonnet string rather than a file. Useful in tests.

### `write(files = this.lastRender)`

Writes each top-level key of the object to `renderPath`, choosing a serialiser by filename. Emits `write`. Returns the frame.

### `addNativeFunction(name, fn, ...parameterNames)`

Registers a native function directly, without a plugin. The name is used verbatim — no namespace is added — so prefix it yourself.

### `addFileTypeHandler(pattern, handler)`

Registers a serialiser. `pattern` is a regular-expression **source string**, matched against the filename.

### `addExternalCode(name, value)`

Exposes a value to Jsonnet's `std.extVar(name)`. Objects are stringified.

### `loadPlugin(packageName, jsMainPath)`

Loads a plugin from an explicit path, registering its natives as `packageName:export`. This is how a plugin's own test harness loads the package it lives in — automatic discovery only finds *dependencies*, never the current package.

```js
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
<p>The native-function cache is not cleared between renders. A frame that renders twice will serve the second render's native calls from the first render's results — correct for a single logical run, wrong if you intend two independent ones. Construct a new frame per render instead.</p>
</div>
