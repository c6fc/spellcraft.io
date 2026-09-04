---
title: Installation
description: What SpellCraft needs, how to get it, and how to confirm it works before you write anything real.
part: Part I · Getting started
chapter: 1
order: 1
---

SpellCraft is a Node package. There is no daemon, no agent, and no account to create.

## Requirements

| | |
|---|---|
| Node.js | 18 or newer |
| A C++ toolchain | Jsonnet is compiled from source on install |
| Terraform | Only if you use `@c6fc/spellcraft-terraform`, which downloads its own binary |

The toolchain requirement comes from `@hanazuki/node-jsonnet`, which builds the Jsonnet interpreter natively. On Debian or Ubuntu that means `build-essential` and `cmake`; on macOS, the Xcode command line tools. If installation fails with a wall of `node-gyp` output, this is almost always why.

## Starting a new project

The fastest path is the generator, which scaffolds a working project and installs everything:

```bash
npm init spellcraft my-infra
cd my-infra
npm run gen
```

That renders `manifest.jsonnet` into `render/`. If you see `render/app.json` appear, everything works.

## Adding SpellCraft to an existing project

```bash
npm install --save @c6fc/spellcraft
```

The `spellcraft` binary is then available through `npx spellcraft` or from an npm script. SpellCraft has no global install step: it resolves plugins from the dependencies of the project you run it in, so a global copy would find nothing.

<div class="note plain">
<div class="label">Why local only</div>
<p>Plugins are discovered by walking your project's dependency tree for packages flagged <code>"spellcraft": true</code>. A globally installed SpellCraft has no project to walk, which is why the CLI is always run through your project.</p>
</div>

## Confirming the install

```bash
npx spellcraft --help
```

You should see the built-in commands — `generate` and `doc` — plus any commands contributed by plugins you have installed. That last part is the useful signal: if you installed a plugin and its commands are missing, the plugin is not being loaded, and the [plugin contract](/docs/plugin-contract.html) chapter explains what SpellCraft looks for.
