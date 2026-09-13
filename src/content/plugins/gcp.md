---
title: GCP
description: Application Default Credentials, the googleapis client from Jsonnet, a GCS state backend, and whole organization trees from one nested description.
group: gcp
nodes: ["gcp.auth", "gcp.terraform"]
order: 2
---

Two nodes. `gcp.auth` resolves credentials and the bound project, and puts the googleapis client
within reach of a manifest. `gcp.terraform` decides where state lives, declares providers, and
builds folder and project hierarchies — including the service enablement that has to happen before
Terraform can plan.

## At a glance

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

{
  // Creates the state bucket if it is missing, and returns the backend block.
  "backend.tf.json": gcp.bootstrap("my-project"),

  // One aliased provider per region matching the filter, plus a default.
  "providers.tf.json": { provider: gcp.providerAliases("us-west2", {}, "us-") },

  // Folders, projects, service accounts, IAM and API activation, ordered.
  "org.tf.json": gcp.googleOrgProject("platform", "us-west2", {
    type: "folder",
    name: "engineering",
    children: [{ type: "project", name: "sandbox" }],
  }),
}
```

## gcp.auth

Authentication is Application Default Credentials — `gcloud auth application-default login`, a
service account key, or the ambient credentials of whatever you are running on.

The **project** is resolved separately, in this order:

1. `GOOGLE_CLOUD_PROJECT`
2. `GCLOUD_PROJECT`
3. the quota project recorded in your ADC file
4. `gcloud config get-value project`

ADC frequently carries no project even when gcloud has one configured, which is why gcloud's own
setting is consulted last rather than not at all. If none of the four yields a project, the render
stops and names all four fixes.

Set `SPELLFRAME_GCP_IMPERSONATE` to a service account address and the resolved credentials are
wrapped to act as it for the whole render.

Like its AWS counterpart, this node has no `init()` hook: credentials resolve on the first native
call that needs them, so a spell that never touches GCP never authenticates.

### `getProjectId()`

The project this render is bound to. Costs no API call — it comes from the resolution order above.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.auth;

{
  "bucket.tf.json": {
    resource: {
      google_storage_bucket: {
        artifacts: {
          name: "%s-artifacts" % gcp.getProjectId(),
          location: "US",
        },
      },
    },
  },
}
```

### `getProjectMetadata()`

Where the project sits in the resource hierarchy and how it is billed:
`{ projectId, quotaProject, organizationId, organizationDomain, directoryId, billingAccount }`. The
organization and billing fields are `false` when the project has none.

It enables `cloudbilling.googleapis.com` on the project if it is not already, so that the billing
account can be read back at all.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.auth;

local meta = gcp.getProjectMetadata();

{
  // A new project billed and parented the same way as the one you are running in.
  "project.tf.json": {
    resource: {
      google_project: {
        sandbox: {
          name: "sandbox",
          project_id: "sandbox-%s" % meta.projectId,
          org_id: meta.organizationId,
          billing_account: meta.billingAccount,
        },
      },
    },
  },
}
```

### `getCallerIdentity()`

The identity the render is authenticated as:
`{ identity, projectId, scopes, expiresIn, authType, impersonatedBy }`.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.auth;

{
  // Give whoever is running the render access to what it creates.
  "iam.tf.json": {
    resource: {
      google_storage_bucket_iam_member: {
        deployer: {
          bucket: "${google_storage_bucket.artifacts.name}",
          role: "roles/storage.objectAdmin",
          member: "user:%s" % gcp.getCallerIdentity().identity,
        },
      },
    },
  },
}
```

### `enableServices(services)`

Enables API services **during the render**, so they are live before any tool runs. This is the
answer to the stage-zero problem: Terraform cannot enable the API that a resource it is creating
depends on, because the provider needs it live before it can plan.

Already-enabled services are left alone and confirmed ones are cached for the life of the process,
so calling it from as many places as you like is cheap. The one cost worth knowing: activating a
service that has never been enabled waits about fifteen seconds for IAM and quota propagation, once
per call that activates something new — so many separate calls each activating one service pay that
wait separately.

`api()`, `listBuckets()` and `listInstances()` already call it for their own service. Reach for it
directly when a manifest calls something that does not self-enable — a different plugin, or a
hand-written native. Jsonnet evaluates lazily and in no guaranteed field order, so the call that
needs the service must **depend on** the result rather than merely follow it:

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.auth;

local ready = gcp.enableServices([
  "compute.googleapis.com",
  "secretmanager.googleapis.com",
]);

{
  // Threading `ready` through is what orders the two.
  "instances.json": if ready then gcp.listInstances({
    project: gcp.getProjectId(),
    zone: "us-west1-b",
  }) else null,
}
```

### `api(fullpath, params={ project: getProjectId() })`

Calls any googleapis method and returns its response body. The path is dot-delimited — service,
version, then the method path: `compute.v1.instances.list`, `storage.v1.buckets.list`,
`cloudresourcemanager.v1.projects.list`.

It enables `<service>.googleapis.com` first, best-effort. That matches Google's naming convention
for the overwhelming majority of services; a wrong guess never blocks the call, and a correct one is
free after the first time. Call `enableServices()` yourself for anything the guess does not cover.

Passing `params` **replaces** the default entirely, so add `project` back when the method needs it.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.auth;

{
  "subnets.json": gcp.api("compute.v1.subnetworks.list", {
    project: gcp.getProjectId(),
    region: "us-west2",
  }),
}
```

### `listBuckets(params={ project: getProjectId() })`

Cloud Storage buckets in the project — a `storage#buckets` response.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.auth;

{ "buckets.json": { names: [b.name for b in gcp.listBuckets().items] } }
```

### `listInstances(params={ project: getProjectId() })`

Compute instances in one zone — a `compute#instanceList` response. A zone is required, and supplying
it replaces the default params, so pass `project` as well. `compute.googleapis.com` is enabled for
you through `api()`.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.auth;

{
  "instances.json": gcp.listInstances({
    project: gcp.getProjectId(),
    zone: "us-west1-b",
  }),
}
```

### From the CLI

```bash
npx spellcraft gcp-identity
```

## gcp.terraform

The GCP half of the Terraform story. Its `bootstrap()`, artifact and remote-state functions mirror
the AWS node's exactly, so what follows concentrates on where they differ — and on
`googleOrgProject()`, which has no AWS counterpart.

Its bootstrap bucket is per **project**, named `spellcraft-terraform-<project-id>`, rather than one
per account discovered by convention.

### `bootstrap(project)`

Creates the GCS bucket if it is missing and returns the `terraform.backend.gcs` block, prefixed
with the project name you pass.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

{ "backend.tf.json": gcp.bootstrap("my-project") }
```

### `getBootstrapBucket()`

The bucket's name for the current project.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

{ "state-location.json": { bucket: gcp.getBootstrapBucket() } }
```

### `putArtifact(name, content)` and `getArtifact(name)`

Store and read a JSON value under this project's prefix, the same way the AWS node does — and with
the same ordering requirement. Both throw until a project name is set, so thread `bootstrap()`'s
result through rather than relying on field order:

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

local backend = gcp.bootstrap("network");

{
  "backend.tf.json": backend,
  "publish.json": {
    published: if backend != null then gcp.putArtifact("network", {
      subnet: "projects/my-project/regions/us-west2/subnetworks/app",
    }) else null,
  },
}
```

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

local backend = gcp.bootstrap("app");
local network = if backend != null then gcp.getArtifact("network") else null;

{
  "backend.tf.json": backend,
  "app.tf.json": {
    resource: {
      google_compute_instance: {
        app: {
          name: "app",
          machine_type: "e2-medium",
          zone: "us-west2-a",
          network_interface: [{ subnetwork: network.subnet }],
        },
      },
    },
  },
}
```

### `getRemoteState(project)`

Another spell's Terraform state, from the same bucket. Outputs are flattened to their values — an
output called `subnet` is `state.outputs.subnet`, with no `.value` to unwrap.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

local network = gcp.getRemoteState("network");

{
  "app.tf.json": { output: { subnet: { value: network.outputs.subnet } } },
}
```

### `providerAliases(default, options, filter="")`

One aliased `google` provider per Compute region — the alias is the region name, so a resource binds
to it as `google.us-west2` — plus an unaliased default for the region you name.

`options` is merged into **every** declaration, which is where a shared `project` or
`billing_project` belongs. `filter` keeps only regions whose name contains it, which matters here in
a way it does not on AWS: GCP has enough regions that declaring an aliased provider for every one
makes for a large and slow `terraform init`.

```jsonnet
local plugins = import "@c6fc/spellcraft-plugins/module.libsonnet";

{
  "providers.tf.json": {
    provider: plugins.gcp.terraform.providerAliases(
      "us-west2",
      { project: plugins.gcp.auth.getProjectId() },
      "us-",
    ),
  },
}
```

### `googleOrgProject(name, region, map)`

Takes one nested description and emits the folders, projects, service accounts, IAM bindings, custom
roles, audit configuration, org policy constraints and API activations to build it — with the
dependency ordering already wired.

Each node is `{ type: "folder" | "project", name, children }` plus whatever that node carries. The
root's parent defaults to the organization the current project belongs to; set `parent` on the map
to place it elsewhere.

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

{
  "org.tf.json": gcp.googleOrgProject("acme", "us-west2", {
    type: "folder",
    name: "engineering",

    iam_members: [{
      role: "roles/resourcemanager.folderAdmin",
      members: ["group:platform@example.com"],
    }],

    children: [
      {
        type: "folder",
        name: "production",
        children: [{
          type: "project",
          name: "api",
          services: ["run.googleapis.com", "secretmanager.googleapis.com"],

          service_accounts: {
            deployer: {
              display_name: "CI deployer",
              identity_policies: ["roles/run.admin"],
            },
          },
        }],
      },
      { type: "project", name: "sandbox" },
    ],
  }),
}
```

`name` prefixes every generated Terraform resource name, and `region` is the region the providers
the tree exposes are bound to.

The service enablement is the part worth understanding. As the manifest evaluates, every service the
tree will need is registered; the node then listens for
`@c6fc/spellcraft-plugins:terraform.pre-apply` and enables the whole set in one call before
Terraform starts. That handshake is what lets a single apply create projects *and* populate them —
the two nodes know nothing about each other and meet on the event.

Names are derived, so two sibling nodes cannot collide silently: a name that normalizes to the same
string as another is refused, naming both paths. Normalization substitutes rather than deletes, so
`Data Platform` and `DataPlatform` stay distinct.

#### `refs::`

The return value carries a hidden `refs` field covering all twenty resource families a fully
populated tree can build, keyed by the caller's **own** names rather than by the derived ones:

```jsonnet
local gcp = (import "@c6fc/spellcraft-plugins/module.libsonnet").gcp.terraform;

local org = gcp.googleOrgProject("acme", "us-west2", {
  type: "folder",
  name: "engineering",
  children: [{ type: "project", name: "sandbox" }],
});

{
  "org.tf.json": org,

  "wiring.tf.json": {
    resource: {
      google_storage_bucket: {
        scratch: {
          name: "scratch-bucket",
          location: "US",
          project: "${%s.project_id}" % org.refs["google_project.engineering.sandbox"]._terraform_id,
        },
      },
    },
  },
}
```

Each entry's value is the resource as it was manifested, plus `_terraform_id` with the address
Terraform uses. Sub-keys follow the caller's path through the tree, so looking one up needs only
what you wrote.

#### Cost

`googleOrgProject()` is the most expensive thing in this package: roughly half a second per
*project* node, so a forty-node tree takes around twenty seconds. Depth is not the problem — node
count is. Its traversal visits every node exactly once and merges once at the end, which is what
keeps depth flat; see [`utils.tree`](/plugins/utils.html) for the walker underneath it.
