---
title: CLI reference
description: The commands SpellCraft ships with, how plugins add their own, and the flags each one accepts.
part: Part III · Reference
chapter: 1
order: 9
---

SpellCraft's CLI is deliberately small. Most of what you can run comes from the plugins you installed, which is why the help output differs between projects.

```bash
npx spellcraft --help
```

## `generate <filename>`

Evaluates a manifest and writes the result.

```bash
npx spellcraft generate manifest.jsonnet
```

Runs every plugin's `init`, evaluates the file, then writes each top-level key to `render/`. See [Rendering output](/docs/rendering-output.html).

## `doc`

Regenerates API documentation in the current package's `README.md`.

```bash
npx spellcraft doc
```

Reads the doc comments in `module.libsonnet` and the commands registered by `module.js`, and replaces the content between marker comments:

```html
<!-- SPELLCRAFT_DOCS_API_START -->
<!-- SPELLCRAFT_DOCS_API_END -->

<!-- SPELLCRAFT_DOCS_CLI_START -->
<!-- SPELLCRAFT_DOCS_CLI_END -->
```

Without those markers the command does nothing and says so. The generated plugin template includes them.

Doc comments are JSDoc-flavoured, and `@example` blocks become fenced Jsonnet:

```jsonnet
{
  /**
   * Prefixes a resource name with the target environment.
   *
   * @param {string} name - the unqualified resource name
   * @returns {string} the name, prefixed
   * @example
   * local module = import "@you/your-plugin/module.libsonnet";
   * { name: module.resourceName("artifacts") }
   */
  resourceName(name):: std.native("@you/your-plugin:resourceName")(name),
}
```

## Commands from plugins

Plugins register commands through `cliExtensions`. Installed ones appear in `--help` automatically. Notable examples:

| Command | From |
|---|---|
| `terraform-apply` | `@c6fc/spellcraft-terraform` |
| `aws-identity` | `@c6fc/spellcraft-aws-auth` |
| `aws-exportcredentials` | `@c6fc/spellcraft-aws-auth` |
| `gcp-identity` | `@c6fc/spellcraft-gcp-auth` |

## Environment variables

| Variable | Effect |
|---|---|
| `SPELLCRAFT_DEBUG` | Report dependencies that were considered as plugins and skipped |
| `AWS_PROFILE`, `AWS_REGION` | Read by `spellcraft-aws-auth` |
| `SPELLFRAME_GCP_IMPERSONATE` | Service account for `spellcraft-gcp-auth` to impersonate |
| `GOOGLE_CLOUD_PROJECT` | Project for `spellcraft-gcp-auth`, ahead of gcloud's configured one |

<div class="note plain">
<div class="label">Debugging a plugin that will not load</div>
<p>Set <code>SPELLCRAFT_DEBUG=1</code>. Discovery skips unresolvable dependencies silently by design — most dependencies are not plugins — so this is the way to see what was passed over and why.</p>
</div>
