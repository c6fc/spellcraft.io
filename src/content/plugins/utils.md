---
title: Utilities
description: Provider-agnostic Jsonnet — a tree walker for turning nested structures into flat configuration, and a deep merge that is not a performance trap.
group: utils
nodes: ["utils.tree", "utils.merge"]
order: 4
---

Two nodes, both pure Jsonnet: no native functions, nothing to authenticate, no network. They are
the machinery `gcp.terraform.googleOrgProject()` is built from, factored out because neither is
about GCP.

## At a glance

```jsonnet
local tree = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.tree;

{
  "org.tf.json": tree.walk({
    name: "engineering",
    children: [
      { name: "production", children: [{ name: "api" }] },
      { name: "staging" },
    ],
  }, {
    inherited: "organizations/123456789",

    // Names accumulate: acme_engineering, acme_engineering_production, ...
    parentName: "acme",
    name(ctx):: "%s_%s" % [ctx.parentName, ctx.body.name],

    // What this node's children inherit — a reference to what it just declared.
    handoff(ctx):: "folders/${google_folder.%s.folder_id}" % ctx.name,

    node(ctx):: {
      resource: { google_folder: { [ctx.name]: {
        display_name: ctx.body.name,
        parent: ctx.inherited,
      } } },
    },
  }),
}
```

## utils.tree

A caller writes a tree. Each node becomes some configuration whose names, parent references and
dependency wiring are derived from *where it sits* in that tree. That is the shape of most
hierarchy-to-configuration problems: org units, account structures, network hierarchies, anything
where a child points at what its parent declared.

`walk()` owns the traversal, the name accumulation and the assembly. You supply what a node
*becomes*.

### `walk(root, spec)`

Two hooks are required, `name(ctx)` and `node(ctx)`; everything else has a default. Every node's
return value is deep-merged into one object, which is returned with a hidden `refs` field when you
supply a `refs(ctx)` hook.

`ctx` carries, at every node:

| field | is |
|---|---|
| `node` | the node exactly as the caller wrote it |
| `body` | that node after `body(node)` — computed once, shared by every hook |
| `label` | this node's caller-facing name, from `label(body)` |
| `path` | `[label, ...]` from the root: the caller's own names, underived |
| `name` | this node's derived name, from `name(ctx)` |
| `parentName` | the parent's derived name |
| `inherited` | whatever the parent's `handoff(ctx)` returned |
| `depth` | `0` at the root |
| `index` | this node's position among its siblings |
| `fragment` | this node's own output — in `refs(ctx)` only |

Three pairs are worth separating up front, because each is easy to confuse:

- **`body` and `node`.** `body` transforms a node on the way *in*, applying defaults; `node`
  produces what comes *out*.
- **`label` and `name`.** `label` is the name the *caller* wrote, and feeds `ctx.path`; `name` is
  what *you* derived from it, and keys your output. Both accumulate down the tree, independently.
- **`inherited` and `handoff`.** `inherited` seeds the *root node only*; `handoff` computes it for
  every level below.

#### The two required hooks

Derive the name from `ctx.path` and it is unique by construction — which matters, because output is
merged rather than concatenated. Two nodes deriving the same name would become one, so a collision
is refused outright, naming both paths.

```jsonnet
local tree = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.tree;

{
  "flat.json": tree.walk({ name: "eng", children: [{ name: "api" }] }, {
    name(ctx):: std.join("_", ctx.path),
    node(ctx):: { [ctx.name]: { depth: ctx.depth } },
  }),
}

// { "eng": { "depth": 0 }, "eng_api": { "depth": 1 } }
```

#### `handoff(ctx)` and `inherited`

This is how a child points at what its parent declared. Without a `handoff`, every node sees the
same seeded value.

```jsonnet
local tree = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.tree;

{
  "folders.json": tree.walk({ name: "eng", children: [{ name: "api" }] }, {
    inherited: "organizations/123456789",
    handoff(ctx):: "folders/${google_folder.%s.folder_id}" % ctx.name,
    name(ctx):: ctx.body.name,
    node(ctx):: { [ctx.name]: { parent: ctx.inherited } },
  }),
}

// "api" gets "folders/${google_folder.eng.folder_id}"; the root keeps the org.
```

#### `body(node)`

Applies defaults once per node. Declaring them hidden keeps inputs that are *yours*, rather than the
output format's, from leaking into what you emit — and `ctx.node` stays the node as written, so you
can still tell what the caller actually supplied.

```jsonnet
local tree = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.tree;

{
  "tiers.json": tree.walk({ name: "root", children: [{ name: "hot", tier: "gold" }] }, {
    body(node):: { tier:: "standard", children:: [] } + node,
    name(ctx):: ctx.body.name,
    node(ctx):: { [ctx.name]: {
      tier: ctx.body.tier,
      explicit: std.objectHas(ctx.node, "tier"),
    } },
  }),
}

// "root" is standard and not explicit; "hot" is gold and explicit.
```

#### `label(body)` and `children`

For a structure that names things its own way. `children` says which field holds descendants —
handy when your data is already shaped for something else — and `label` says which one names a node.

```jsonnet
local tree = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.tree;

{
  "units.json": tree.walk({ id: "eng", units: [{ id: "api" }] }, {
    children: "units",
    label(body):: body.id,
    name(ctx):: std.join("-", ctx.path),
    node(ctx):: { [ctx.name]: { label: ctx.label } },
  }),
}

// { "eng": { "label": "eng" }, "eng-api": { "label": "api" } }
```

#### `root(built)`

Receives the whole assembled tree, once every node has merged. This is for anything that needs every
node at once — a resource depending on all the others, say — which cannot be written from inside a
node.

```jsonnet
local tree = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.tree;

{
  "org.tf.json": tree.walk({ name: "eng", children: [{ name: "api" }] }, {
    name(ctx):: ctx.body.name,
    node(ctx):: { resource: { thing: { [ctx.name]: {} } } },
    root(built):: built + {
      resource+: { marker: { all: {
        depends_on: ["thing.%s" % n for n in std.objectFields(built.resource.thing)],
      } } },
    },
  }),
}
```

#### `refs(ctx)`

The only hook whose `ctx` carries `fragment`, so addresses are read out of what the node actually
built rather than rebuilt from what it was asked to build. Entries are shallow-merged across the
tree into a hidden `refs` field.

```jsonnet
local tree = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.tree;

local built = tree.walk({ name: "eng", children: [{ name: "api" }] }, {
  name(ctx):: std.join("_", ctx.path),
  node(ctx):: { resource: { thing: { [ctx.name]: { id: ctx.name } } } },
  refs(ctx):: {
    ["thing.%s" % std.join(".", ctx.path)]:
      ctx.fragment.resource.thing[ctx.name]
      + { _terraform_id:: "thing.%s" % ctx.name },
  },
});

{
  // refs is hidden, so it never reaches the rendered file.
  "org.tf.json": built,
  "lookup.json": { api: built.refs["thing.eng.api"]._terraform_id },
}

// "lookup.json" is { "api": "thing.eng_api" }
```

### Two properties to rely on

**Every node is visited exactly once**, and fragments are collected flat and merged once at the end.
Merging as the recursion unwinds stacks a merge layer per level of the tree, which is the shape that
made this pattern unusable in `googleOrgProject()` before it was rewritten onto this walker.

**Nothing here prunes.** If your fragments contain empty families or nulls you do not want, prune
inside `node(ctx)`. Keeping it in the caller means the cost stays visible and attributable to
whoever incurs it.

Four things are checked, each at the point where the context for a good message exists: that both
required hooks are present, that `children` is an array rather than a map, that `node(ctx)` returns
an object, and that no two nodes derive the same name.

## utils.merge

Jsonnet's standard library has no `std.deepMerge`, so `std.mergePatch` is what you reach for when
you want one. It is a trap, and an expensive one.

`std.mergePatch` implements JSON Merge Patch, where a `null` on the right means *delete this key*.
Honouring that requires knowing which of the patch's values are null, and it computes that as part
of the result's **key set** — which Jsonnet evaluates eagerly, at construction. So merely
*constructing* a merge force-evaluates a whole level of the patch, each field of the result is
another `mergePatch` forcing the next level down, and because function calls are not memoized, every
merge layer stacked over a subtree re-triggers that walk.

Anything merging once per level of a recursive structure therefore pays a compounding cost:

| nesting | `std.mergePatch` | `merge.deep` |
|---|---|---|
| `folder>project` | 10.1s | 1.4s |
| depth 2 | 28.3s | 1.8s |
| depth 3 | 65.3s | 2.1s |
| depth 4 | 130.4s | 2.6s |

**If you do not need a `null` on the right-hand side to delete a key, you do not need
`std.mergePatch`.**

Two things to know before using these. **Nulls are ordinary values** —
`merge.deep({a: 1}, {a: null})` gives `{a: null}` where `std.mergePatch` gives `{}`, and that is the
whole semantic difference. And **hidden fields do not survive**: the result is built by a
comprehension and `std.objectFields` sees only visible fields, so keep anything hidden — a `refs::`
map, say — beside the merge rather than inside it.

### `deep(a, b)`

Recursively merges `b` over `a`.

```jsonnet
local merge = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.merge;

local base = {
  resource: {
    aws_s3_bucket: { artifacts: { bucket_prefix: "artifacts-", force_destroy: false } },
  },
};

{
  "main.tf.json": merge.deep(base, {
    resource: { aws_s3_bucket: { artifacts: { force_destroy: true } } },
  }),
}

// bucket_prefix survives; force_destroy becomes true.
```

Note what `+` would have done instead: it is a *shallow* merge, so the right-hand `resource` would
have replaced the left one outright. Jsonnet's `+:` operator does descend, but it has to be written
at every level — `{ resource+: { aws_s3_bucket+: { artifacts+: { ... } } } }`. Use `+:` when you are
writing the override by hand and `merge.deep` when the two sides are values you were handed.

### `all(objs)`

Deep-merges a list, left to right.

```jsonnet
local merge = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.merge;

local defaults = { tags: { managed_by: "spellcraft", env: "dev" } };
local perEnv = { tags: { env: "prod" } };
local perTeam = { tags: { team: "platform" } };

{ "tags.json": merge.all([defaults, perEnv, perTeam]) }

// { "tags": { "managed_by": "spellcraft", "env": "prod", "team": "platform" } }
```

The left fold is deliberate: a balanced divide-and-conquer merge was measured against it on a
40-node tree and made no difference, so the simpler shape stays.

### `shallow(objs)`

Merges a list one level deep, left to right. For flat maps whose keys are already fully qualified —
a `refs` map keyed by `"<type>.<name path>"`, for instance — where a deep merge would be wasted work
and a collision would mean two things share an address anyway.

```jsonnet
local merge = (import "@c6fc/spellcraft-plugins/module.libsonnet").utils.merge;

{
  "refs.json": merge.shallow([
    { "aws_s3_bucket.artifacts": { id: "artifacts-abc" } },
    { "aws_s3_bucket.logs": { id: "logs-def" } },
  ]),
}
```
