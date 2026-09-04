---
title: Your first spell
description: Writing a manifest that discovers something real about your account, and understanding what each part of it does.
part: Part I · Getting started
chapter: 2
order: 2
---

A *spell* is a project SpellCraft renders. Its entry point is `manifest.jsonnet`, and the whole model fits in one sentence: top-level keys are filenames, and their values are the file contents.

## The smallest useful manifest

```jsonnet
local spellcraft = import "spellcraft";

{
  "config.json": {
    renderedFrom: spellcraft.path(),
  },
}
```

Render it:

```bash
npx spellcraft generate manifest.jsonnet
```

SpellCraft evaluates the file and writes `render/config.json`. The key became the filename; the value became the contents, serialised as JSON because the filename ends in `.json`.

## Making it discover something

The point of SpellCraft is that evaluation can reach out. Install a provider plugin:

```bash
npm install --save @c6fc/spellcraft-aws-auth
```

```jsonnet
local aws = import "@c6fc/spellcraft-aws-auth/module.libsonnet";

local identity = aws.getCallerIdentity();

{
  "account.json": {
    account: identity.Account,
    principal: identity.Arn,
  },
}
```

Render that and `render/account.json` contains your real account number, fetched from STS while the Jsonnet was being evaluated. Nobody typed it, and nobody has to update it when you switch accounts.

<div class="note">
<div class="label">This is the whole idea</div>
<strong>Configuration that asks, rather than configuration that is told</strong>
<p>The account number above is not a variable you set, a <code>tfvars</code> file you maintain, or a value your CI injects. It is a question the configuration asks at the moment it renders. Everything else in SpellCraft exists to make that pattern practical: plugins to supply the questions, events to order them, and memoisation to keep them cheap.</p>
</div>

## Three kinds of import

```jsonnet
local spellcraft = import "spellcraft";                           // built-ins
local modules = import "modules";                                 // spellcraft_modules/
local aws = import "@c6fc/spellcraft-aws-auth/module.libsonnet";  // installed plugins
```

- **`"spellcraft"`** is the built-in library. It is small on purpose: `envvar(name)` and `path()`.
- **`"modules"`** is generated from your project's `spellcraft_modules/` directory. See [Local modules](/docs/local-modules.html).
- **A package path** imports an installed plugin's Jsonnet facade.

## Producing more than one file

Because the keys are filenames, a manifest can emit an entire directory:

```jsonnet
{
  "main.tf.json": { /* ... */ },
  "variables.tf.json": { /* ... */ },
  "README.md": "# Generated. Do not edit.\n",
}
```

Each file is serialised according to its extension. [Rendering output](/docs/rendering-output.html) covers how that dispatch works and how to add your own formats.
