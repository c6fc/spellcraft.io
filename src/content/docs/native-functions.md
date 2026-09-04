---
title: Native functions
description: The seam between Jsonnet and JavaScript — how to export one, how it is named, what it may be passed, and why it only runs once.
part: Part II · Concepts
chapter: 2
order: 5
---

Native functions are what let a manifest ask your cloud provider a question while it is being evaluated, instead of being handed an answer that someone pasted in. They are the only impure thing in a render.

## Exporting a function

Every export from a plugin's entry point other than `_spellcraft_metadata` becomes a native function. Export it bare, or as an array naming its parameters:

```js
// Names given explicitly. Always correct.
exports.resourceName = [function (name) {
  return `${this.environment}-${name}`;
}, 'name'];

// Names inferred from the source. Convenient, but see below.
exports.timestamp = () => new Date().toISOString();
```

Prefer the array form. Jsonnet calls native functions by parameter name, so the names have to be recovered somehow — and the bare form recovers them by parsing the function's own source, which cannot work for minified code or destructured parameters. When inference cannot produce a usable name, SpellCraft raises at load time and tells you which export to annotate, rather than registering something that fails later at a call site in someone else's manifest.

## Namespacing

Functions register as `<package-name>:<export>`, so two plugins can both export `client` without colliding. Your `module.libsonnet` must therefore use the fully qualified name:

```jsonnet
{
  resourceName(name):: std.native("@you/your-plugin:resourceName")(name),
}
```

This is the single most common mistake when writing a first plugin. `std.native("resourceName")` resolves to nothing, and Jsonnet reports it as `only functions can be called, got null` — pointing at your libsonnet rather than at the missing prefix. The [module generator](/docs/plugin-contract.html) interpolates your package name into the template so a new plugin starts out correct.

<div class="note">
<div class="label">Constraint</div>
<strong>Arguments must be primitives</strong>
<p>Jsonnet will not pass an object or an array into a native function — it raises <em>“native extensions can only take primitives”</em>. Serialise on the way in and parse inside the function.</p>
</div>

The idiomatic workaround, used throughout the official plugins:

```jsonnet
{
  api(client, method, params={}):: std.native("@c6fc/spellcraft-aws-auth:aws")(
    std.manifestJsonEx(client, ''),
    method,
    std.manifestJsonEx(params, ''),
  ),
}
```

```js
exports.aws = [async function (client, method, params) {
  client = JSON.parse(client);
  params = JSON.parse(params);
  // ...
}, 'client', 'method', 'params'];
```

Return values carry no such restriction: a native function may return any JSON-serialisable structure, and usually does.

## Asynchrony

A native function may be `async`. Jsonnet's evaluation waits for the promise, so from the manifest's point of view an API call is an ordinary expression:

```jsonnet
{ "account.json": aws.getCallerIdentity() }
```

There is no `await` in Jsonnet and none is needed.

## Memoisation

Results are cached per `(name, arguments)` for the life of a render. Calling `getCallerIdentity()` in forty places costs one API call, and a timestamp taken twice within a render agrees with itself.

This has a consequence worth internalising: **side effects fire once**. A native function that creates a bucket will not create it again later in the same render, even from a different call site. If you need work to happen on a schedule rather than on demand, that is a signal it belongs in an [init hook or a lifecycle event](/docs/lifecycle-events.html) instead of a native function.

## Reaching shared context

Inside a native function, `this` is the shared function context — everything every loaded plugin contributed through `functionContext`, plus `spellframe`, the frame itself.

```js
exports.whereAmI = [function () {
  return this.spellframe.activePath;
}];
```

Use an ordinary `function () {}` declaration to reach it. An arrow function captures `this` from module scope, where it is empty — a mistake that fails silently, returning `undefined` rather than raising.
