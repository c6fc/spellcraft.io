---
title: Manifests
description: The filename-to-contents model, why Jsonnet was chosen for it, and the composition patterns that make large configurations stay readable.
part: Part II · Concepts
chapter: 1
order: 4
---

A manifest is an ordinary Jsonnet file whose evaluated result is an object. SpellCraft imposes exactly one convention on it: the top-level keys are filenames.

## Why Jsonnet

Jsonnet is a configuration language that produces JSON, with the features that HCL keeps almost having: real functions, real imports, object inheritance, and comprehensions. Two properties matter most here.

**Composition is native.** The `+` operator deep-merges objects, and `+:` merges into an inherited field. A plugin can hand you a complete resource definition and you can adjust one nested field of it without the plugin having exposed a parameter for that field:

```jsonnet
local s3 = import "@c6fc/spellcraft-aws-s3/module.libsonnet";

s3.bucket("artifacts", "us-west-2") + {
  resource+: {
    aws_s3_bucket+: {
      artifacts+: { force_destroy: true },
    },
  },
}
```

Nothing in the plugin anticipated `force_destroy`. It did not need to.

**Evaluation is lazy and pure.** Nothing is computed until something needs it, and Jsonnet itself cannot perform side effects. That purity is what makes SpellCraft's escape hatch safe to reason about: every impure thing in a render happens in a [native function](/docs/native-functions.html), and those are the only places to look when output surprises you.

## Structuring a larger spell

Manifests get long. The usual remedy is to split by output file:

```jsonnet
local network = import "./stacks/network.libsonnet";
local data = import "./stacks/data.libsonnet";

{
  "network.tf.json": network.render(),
  "data.tf.json": data.render(),
}
```

Or, when several stacks contribute to one file, merge them:

```jsonnet
{
  "main.tf.json": network.render() + data.render() + compute.render(),
}
```

Both are just Jsonnet. SpellCraft has no opinion about how you organise the files that produce the object — only about the object's top level.

## Hidden fields

A field declared with `::` is hidden: it participates in inheritance and computation but never appears in the output.

```jsonnet
{
  local region = "us-west-2",

  defaults:: {
    tags: { managed_by: "spellcraft" },
  },

  "main.tf.json": self.defaults + {
    provider: { aws: { region: region } },
  },
}
```

`defaults` shapes the output without becoming a file called `defaults`. This is the idiomatic way to share structure between output files in one manifest, and it is why plugins declare their internal helpers with `::` too.

## Parameterising a render

There is deliberately no `--var` flag. Configuration that varies comes from the environment, discovered at render time:

```jsonnet
local spellcraft = import "spellcraft";

local environment =
  local declared = spellcraft.envvar("ENVIRONMENT");
  if declared == false then "dev" else declared;
```

`envvar` returns `false` — not `null`, not an error — when a variable is unset, which makes defaulting a plain conditional.

<div class="note plain">
<div class="label">On the missing --var</div>
<p>A flag would be a second, weaker source of truth competing with the one SpellCraft is built around. If a value is knowable from your cloud account, discover it; if it is genuinely an operator's choice, an environment variable is already the portable way to express that across shells, CI and local runs.</p>
</div>
