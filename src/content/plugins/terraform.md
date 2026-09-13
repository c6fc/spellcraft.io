---
title: Terraform
description: The provider-neutral lifecycle node — rendering, applying, destroying, the events other plugins hang work on, and the binary it manages.
group: terraform
nodes: ["terraform"]
order: 3
---

One node, and the only one with no Jsonnet API at all. It knows nothing about any particular cloud:
it owns the Terraform binary, the apply, and the lifecycle events that let provider plugins do their
work at the right moment. `plugins.aws.terraform` and `plugins.gcp.terraform` build on it.

## At a glance

```jsonnet
{
  "main.tf.json": {
    terraform: { required_version: ">= 1.2" },
    resource: {
      aws_s3_bucket: {
        artifacts: { bucket_prefix: "artifacts-" },
      },
    },
  },
}
```

```bash
npx spellcraft terraform-apply manifest.jsonnet
```

## terraform

Provider-neutral Terraform lifecycle: it renders a manifest, then runs Terraform on the result. It
has no Jsonnet API — nothing to import, nothing to call — so what it contributes is two CLI
commands, a file handler and four events.

### Rendering and applying

Terraform reads JSON, so a manifest emits `.tf.json` files and needs no special handling. The
command renders the manifest into `render/`, then runs `terraform init` and `terraform apply`
there. `render/` **is** the Terraform root module — there is no separate working directory to keep
in sync.

| flag | effect |
|---|---|
| `-y`, `--auto-approve` | pass `-auto-approve` to `terraform apply` |
| `-s`, `--skip-init` | skip `terraform init`, for when you manage it yourself |

### Tearing down

```bash
npx spellcraft terraform-destroy manifest.jsonnet --auto-approve
```

This re-renders the manifest first. Since `render/` is cleaned and rewritten on every run, the
module Terraform destroys is always the one matching the manifest, never a stale one left over from
the last apply. Same two flags.

### The `.tf` file handler

This node registers a serialiser for `.tf`, which writes a string through verbatim. That is what
makes hand-written HCL carryable: `importstr` reads the file at evaluation time and the handler
writes it out unchanged, beside the generated JSON.

```jsonnet
{
  "networking.tf": importstr "./hcl/networking.tf",

  "main.tf.json": {
    output: {
      summary: { value: "${local.network_name} ${var.cidr}" },
    },
  },
}
```

Terraform reads every `.tf` and `.tf.json` in the directory as one module, so the generated JSON
above can reference a `local` or `variable` declared in the carried-forward HCL. Adoption can start
with a directory of existing HCL and move declarations into Jsonnet one at a time. The file is
written as-is; interpolating it is not supported.

### Lifecycle events

Each command announces its phases, so other plugins can act at the right moment without this node
knowing they exist.

| event | when |
|---|---|
| `@c6fc/spellcraft-plugins:terraform.pre-apply` | after the manifest is rendered and written, before `terraform init` |
| `@c6fc/spellcraft-plugins:terraform.post-apply` | after `terraform apply` returns |
| `@c6fc/spellcraft-plugins:terraform.pre-destroy` | after the manifest is rendered and written, before `terraform init` |
| `@c6fc/spellcraft-plugins:terraform.post-destroy` | after `terraform destroy` returns |

The name is the full `"<package>:<node>.<phase>"` string, **not** the `plugins.` prefix a Jsonnet
call site uses. A listener registered against `plugins.terraform:pre-apply` is simply never called.

`pre-apply` is the one that matters. It is what solves step zero — the work that has to happen
before Terraform can plan, which Terraform cannot do for itself. `plugins.gcp.terraform` listens on
it to enable the GCP services the rendered configuration is about to need:

```js
exports._spellcraft_metadata = {
  init: async (spellframe) => {
    spellframe.on('@c6fc/spellcraft-plugins:terraform.pre-apply', async () => {
      await enablePendingServices();
    });
  },
};
```

Listeners are awaited in registration order, so one that throws stops the apply before it starts.
See [Lifecycle events](/docs/lifecycle-events.html) for the general mechanism.

### The binary

Downloaded on first use, checksum-verified against HashiCorp's published `SHA256SUMS`, and cached
under `node_modules/.cache`. Nothing is fetched until a command actually reaches the point of
running Terraform, so a manifest that fails to render, or a `pre-apply` listener that throws,
downloads nothing.

It defaults to **1.2.5**. Pin another in your project's `package.json`:

```json
{
  "config": {
    "tf_version": "1.9.8"
  }
}
```

All of this node's own output goes to stderr and Terraform's own stdout is handed through untouched,
so `terraform output -raw <name>` can be captured from a wrapping script without filtering.
