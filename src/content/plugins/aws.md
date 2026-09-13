---
title: AWS
description: Credentials, the SDK reachable from Jsonnet, an S3 state backend, and factories for buckets and Lambda functions.
group: aws
nodes: ["aws.auth", "aws.terraform", "aws.terraform.s3", "aws.terraform.lambda"]
order: 1
---

Four nodes. `aws.auth` resolves credentials and puts the AWS SDK within reach of a manifest;
`aws.terraform` decides where state lives and declares the providers everything else binds to; and
its two children build the resources a bucket or a Lambda function actually needs.

Everything below is reached from one import:

```jsonnet
local plugins = import "@c6fc/spellcraft-plugins/module.libsonnet";

{ "account.json": { id: plugins.aws.auth.getCallerIdentity().Account } }
```

## At a glance

```jsonnet
local plugins = import "@c6fc/spellcraft-plugins/module.libsonnet";
local aws = plugins.aws.terraform;
local s3 = plugins.aws.terraform.s3;

{
  // Creates the state bucket if it is missing, and returns the backend block.
  "backend.tf.json": aws.bootstrap("my-project"),

  // One aliased provider per region the account can see, plus a default.
  "providers.tf.json": { provider: aws.providerAliases("us-east-1") },

  // KMS-encrypted, public access blocked, TLS 1.2 enforced.
  "artifacts.tf.json": s3.bucket("artifacts", "us-west-2"),
}
```

## aws.auth

Credentials, role chaining and profile handling, with the AWS SDK for JavaScript v2 callable
directly from Jsonnet. Method names pass through untouched, so anything in the v2 API reference is
reachable — no per-service wrapper to wait for.

Credentials resolve on the **first call that needs them**, not during `init()`, and are memoised for
the rest of the process. A spell that never touches AWS never authenticates.

With `AWS_PROFILE` set, that profile is used, including one that assumes a role; you are prompted
for MFA if it needs one, and the session is cached. Set `SPELLCRAFT_ASSUMEROLE` to an ARN and the
render proceeds as that role, with a session named `spellcraft_assumerole_<epoch-ms>` — worth
knowing when you write its trust policy.

### `getCallerIdentity()`

The identity the render is authenticated as, after any role chaining. Returns
`{ UserId, Account, Arn }`. One request no matter how many call sites read it.

Naming a bucket after the account that will own it, without anyone typing the number:

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.auth;

local account = aws.getCallerIdentity().Account;

{
  "state.tf.json": {
    resource: {
      aws_s3_bucket: {
        state: { bucket: "tfstate-%s-us-east-1" % account },
      },
    },
  },
}
```

### `client(service, params={})`

Describes a service client — a plain object naming the service and its constructor options, which
`api()` hands to the SDK. Nothing is instantiated here. Reach for it when a call needs non-default
client options, a region above all.

### `api(clientObj, method, params={})`

Calls a method on that client and returns the response as an ordinary Jsonnet object.

Together, the pair reaches a regional service:

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.auth;

local ec2 = aws.client("EC2", { region: "eu-west-1" });

{
  "zones.json": {
    zones: [z.ZoneName for z in aws.api(ec2, "describeAvailabilityZones").AvailabilityZones],
  },
}
```

### `call(name, method, params={})`

Shorthand for `api(client(name, { region: "us-east-1" }), method, params)`.

Note the pinned region. It is right for global endpoints — STS, IAM, Organizations, Route 53 — and
silently wrong for a regional service, which will answer for `us-east-1` rather than for the region
you had in mind. For anything regional, build the client yourself.

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.auth;

{
  "org.json": aws.call("STS", "getCallerIdentity"),
}
```

### `getRegionsList()`

Every region name the current credentials can see, from one `describeRegions` call against
`us-east-1`. This is the list `providerAliases()` is built on, and it reflects what the account
actually has enabled rather than what the partition contains.

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.auth;

{
  "buckets.tf.json": {
    resource: {
      aws_s3_bucket: {
        ["logs_%s" % std.strReplace(region, "-", "_")]: {
          bucket: "acme-logs-%s" % region,
          provider: "aws.%s" % region,
        }
        for region in aws.getRegionsList()
      },
    },
  },
}
```

### `getAvailabilityZones()`

Zone names keyed by region: `{ "us-east-1": ["us-east-1a", ...], ... }`.

Be aware of the cost — one `describeRegions` plus one `describeAvailabilityZones` per region, so
tens of calls. Memoisation makes it once per render rather than once per use, but it is not
something to reach for casually.

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.auth;

local zones = aws.getAvailabilityZones();

{
  // Subnets across the first two zones of one region, without pinning
  // zone letters that differ per account.
  "subnets.tf.json": {
    resource: {
      aws_subnet: {
        ["app_%d" % i]: {
          availability_zone: zones["us-east-1"][i],
          cidr_block: "10.0.%d.0/24" % i,
          vpc_id: "${aws_vpc.main.id}",
        }
        for i in [0, 1]
      },
    },
  },
}
```

### From the CLI

```bash
npx spellcraft aws-identity           # print the identity this project renders as
npx spellcraft aws-exportcredentials  # emit the resolved credentials as env vars
```

Both force authentication themselves and run no plugin's `init`, so neither downloads or prepares
anything unrelated.

## aws.terraform

The AWS half of the Terraform story: where state lives, how one spell reads another's values, and
the provider declarations everything region-aware binds to. `plugins.terraform` runs the apply;
this tells it what to apply against.

### `bootstrap(project)`

Creates the bootstrap bucket if it does not exist and returns the Terraform `backend` block for it.
This is the one function here that writes.

There is **one bucket per account**, discovered by naming convention and shared by every spell,
which is why `project` is required: it becomes the key prefix separating one spell's state from
another's. Finding more than one candidate bucket is an error rather than a guess.

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform;

{ "backend.tf.json": aws.bootstrap("my-project") }
```

Calling it twice with *different* names in one process throws — a spell has one project. To read
another spell's state, use `getRemoteState()`.

`config.spellcraftProject` in your `package.json` supplies the project name ahead of evaluation, so
`getArtifact()` and `putArtifact()` have a namespace before anything forces `bootstrap()`. It is a
file read, no network, and it does not replace the call: creating the bucket and returning the
backend block is still `bootstrap()`'s job. A name that disagrees with the configured one throws,
naming both sources.

### `getBootstrapBucket()`

The bucket's name, or `false` when none exists yet. Discovery is by naming convention rather than
by tag, and more than one match in the account is an error.

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform;

{ "state-location.json": { bucket: aws.getBootstrapBucket() } }
```

### `putArtifact(name, content)`

Stores any JSON-serialisable value in the bootstrap bucket under this project's prefix. Artifacts
are how one spell hands a value to another without a Terraform data source — the value is fetched
while the *next* manifest evaluates, so it can shape that configuration rather than only appear in
it.

### `getArtifact(name)`

Reads one back, parsed from JSON.

Both throw if no project name has been set. Jsonnet does not guarantee field order, so make the
dependency explicit by threading `bootstrap()`'s result through rather than merely calling both in
the same manifest:

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform;

local backend = aws.bootstrap("network");

{
  "backend.tf.json": backend,

  // The `if backend != null` is what forces bootstrap() to run first.
  "publish.json": {
    published: if backend != null then aws.putArtifact("network", {
      subnetId: "subnet-abc123",
      vpcId: "vpc-abc123",
    }) else null,
  },
}
```

And in the spell that consumes it:

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform;

local backend = aws.bootstrap("app");
local network = if backend != null then aws.getArtifact("network") else null;

{
  "backend.tf.json": backend,
  "app.tf.json": {
    resource: {
      aws_instance: {
        app: { subnet_id: network.subnetId, instance_type: "t3.micro" },
      },
    },
  },
}
```

### `getRemoteState(project)`

Reads another SpellCraft project's Terraform state from the same bucket. The name is the one passed
to *that* spell's `bootstrap()`.

Outputs are **flattened to their values** — an output called `vpc_id` is `state.outputs.vpc_id`,
with no `.value` to unwrap. Resources are keyed by type and name, with data sources under
`state.data`.

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform;

local network = aws.getRemoteState("network");

{
  "app.tf.json": {
    resource: {
      aws_instance: {
        app: { subnet_id: network.outputs.subnet_id, instance_type: "t3.micro" },
      },
    },
  },
}
```

Artifacts and remote state answer different questions. An artifact is a value one spell chose to
publish; remote state is whatever another spell happens to output. Prefer the artifact when you
control both ends.

### `providerAliases(default)`

Builds the whole set of `aws` provider declarations: one aliased provider per region the credentials
can see — the alias *is* the region name, so a resource binds to it as `aws.us-west-2` — plus an
unaliased default for the region you name.

This is what lets `s3.bucket()` and `lambda.nodejs_function()` take a region as an argument without
every spell wiring providers by hand.

```jsonnet
local aws = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform;

{ "providers.tf.json": { provider: aws.providerAliases("us-east-2") } }
```

## aws.terraform.s3

Pure Jsonnet, no natives of its own. `bucket()` composes the sixteen-odd Terraform resources a
properly configured bucket needs, and asks only for what differs from a sensible default.

### `bucket(name, region, options={})`

Returns a `{ resource: { ... } }` object — one call, one manifest key.

With no options: a KMS-encrypted bucket with its own customer-managed key and rotation on, all four
public access blocks set, a policy denying any request below TLS 1.2, `BucketOwnerEnforced`
ownership, and versioning disabled. That is eight resources; the other eight appear only when the
option that needs them is set.

```jsonnet
local plugins = import "@c6fc/spellcraft-plugins/module.libsonnet";
local aws = plugins.aws.terraform;
local s3 = plugins.aws.terraform.s3;

{
  "providers.tf.json": { provider: aws.providerAliases("us-east-1") },

  "artifacts.tf.json": s3.bucket("artifacts", "us-west-2"),

  "scratch.tf.json": s3.bucket("scratch", "eu-west-1", {
    versioning: "Enabled",
    lifecycle_rule: [{
      id: "expire",
      status: "Enabled",
      expiration: { days: 30 },
    }],
  }),
}
```

`name` is the **Terraform resource key**, not the bucket name: the bucket is created with
`bucket_prefix`, so it deploys as `artifacts-<suffix>` with a suffix AWS generates. S3's namespace
is global, and this keeps it from being something you negotiate by hand. Reference the real name the
usual way, `"${aws_s3_bucket.artifacts.id}"`.

Every resource binds to `provider: "aws.<region>"`, so the spell needs matching aliases — which is
what `providerAliases()` above is for.

#### Presets

`type` selects one. Options you pass alongside it win.

| `type` | what it sets |
|---|---|
| `static-site` | `public_access_block: false`, `server_side_encryption: false`, `website: true`, and a statement allowing `s3:GetObject` to any principal |
| `log-storage` | `acl: "log-delivery-write"` with `object_ownership: "ObjectWriter"` — both are needed, since a canned ACL is ignored entirely under `BucketOwnerEnforced` |

```jsonnet
local s3 = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform.s3;

{
  "site.tf.json": s3.bucket("site", "us-west-2", { type: "static-site" }),
  "logs.tf.json": s3.bucket("logs", "us-west-2", { type: "log-storage" }),
}
```

An unknown `type` is refused by name rather than ignored: `static_site` for `static-site` used to
return a fully locked-down private bucket where a public website was asked for.

#### Options

Anything not listed here passes straight through as an attribute of `aws_s3_bucket`.

| option | default | effect |
|---|---|---|
| `acceleration_status` | `false` | `Enabled` or `Suspended` |
| `acl` | `false` | A canned ACL; only takes effect when ownership is not `BucketOwnerEnforced` |
| `allow_insecure_access` | `false` | `true` omits the TLS 1.2 deny statement |
| `cors_rule` | `[]` | CORS rules |
| `lifecycle_rule` | `[]` | Lifecycle rules |
| `logging` | `""` | The **name** of a bucket to deliver access logs to |
| `object_lock_configuration` | `[]` | Object lock rules |
| `object_ownership` | `BucketOwnerEnforced` | Also `BucketOwnerPreferred`, `ObjectWriter` |
| `policy_statements` | `[]` | IAM statements as IAM accepts them, merged with the TLS deny |
| `public_access_block` | `true` | Sets all four settings together |
| `replication_configuration` | `{}` | `role` plus `rule`, passed through whole |
| `request_payer` | `BucketOwner` | Also `Requester` |
| `server_side_encryption` | `true` | A dedicated KMS key; `false` for none |
| `versioning` | `Disabled` | Also `Enabled`, `Suspended` |
| `website` | `{}` | `true` for the `index.html` / `error.html` pair, or a full configuration |

`bucket:` is refused — the name comes from `name` through `bucket_prefix`. It is the one key that
would otherwise be *silently* dropped, which inverts what you would expect: a genuinely wrong key
reaches Terraform and fails at plan, while a real, valid argument disappeared without a word.

#### `refs::`

One call builds up to sixteen resources, each with a name this plugin derived. The return value's
hidden `refs` field makes every one addressable as `"<resource_type>.<the name you passed>"`, so
nothing has to guess at internal naming:

```jsonnet
local s3 = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform.s3;

local bucket = s3.bucket("mybucket", "us-west-2", { versioning: "Enabled" });

{
  "buckets.tf.json": bucket,

  "wiring.tf.json": {
    output: {
      // The KMS key this call created, without knowing it is named
      // "s3_mybucket" internally.
      key: { value: "${%s.arn}" % bucket.refs["aws_kms_key.mybucket"]._terraform_id },

      // Read straight off the resource as it was manifested.
      versioning: {
        value: bucket.refs["aws_s3_bucket_versioning.mybucket"].versioning_configuration.status,
      },
    },
  },
}
```

Each entry's value is the resource **as manifested**, plus a hidden `_terraform_id` holding the
address Terraform uses. The two agree for every family but `aws_kms_key`, whose real address is
`aws_kms_key.s3_mybucket` — which is the reason `refs` exists. A family that was not built has no
entry, so with no `website` option there is nothing to reference.

## aws.terraform.lambda

Pure Jsonnet. One call produces a Node.js function, its execution role and policies, its log group,
X-Ray tracing, an `archive_file` that zips your source, and a `null_resource` that runs
`npm install` in it first.

### `config(defaults={})`

Required, once per file. `thisFile` must be `std.thisFile`, written at **your** call site:

```jsonnet
local lambda = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform.lambda.config({
  thisFile: std.thisFile,
});

{ "lambda.tf.json": lambda.nodejs_function("my_function", "us-east-1") }
```

Source for `my_function` is then expected at `lambda_functions/my_function/`, sibling to the file
you wrote `std.thisFile` in.

It cannot be defaulted here, because `std.thisFile` is **lexical**: it names whichever file the
token is physically written in, no matter who calls the function containing it. A default written
inside the plugin would resolve to the plugin's own directory. Calling `nodejs_function()` without
`config()` fails immediately and by name rather than producing a path that happens to work on the
author's machine and breaks on everyone else's.

Anything else passed to `config()` becomes a default for every call made through the result, and a
call's own options win:

```jsonnet
local lambda = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform.lambda.config({
  thisFile: std.thisFile,
  tracing: "PassThrough",
  timeout: 30,
});

{
  "worker.tf.json": lambda.nodejs_function("worker", "us-east-1"),
  "scheduler.tf.json": lambda.nodejs_function("scheduler", "us-east-1", { tracing: "Active" }),
}
```

The same call is what lets this node work from inside *another* plugin: written in that plugin's
own `module.libsonnet`, `std.thisFile` resolves `lambda_functions/` inside that package rather than
inside whatever project installs it.

### `nodejs_function(name, region, options={})`

The factory. Recognised options are hidden from the rendered resource; anything else passes through
to `aws_lambda_function`, so `runtime`, `handler`, `memory_size` and `environment` are all yours to
set.

| option | default | purpose |
|---|---|---|
| `arns_allowed_to_invoke` | `[]` | ARNs granted `lambda:InvokeFunction` |
| `services_allowed_to_invoke` | `[]` | Objects with `principal`, optionally `source_arn` |
| `event_triggers` | `[]` | `aws_cloudwatch_event_rule` bodies; rule, target and permission are wired for you |
| `execution_policy_attachments` | `[]` | Managed policy ARNs to attach to the role |
| `execution_policy_statements` | `[]` | Inline IAM statements |
| `cloudwatch_log_retention_days` | `30` | Log group retention |
| `retain_logs_on_destroy` | `true` | Keep the log group when the function is destroyed |
| `tracing` | `Active` | X-Ray mode: `Active` or `PassThrough` |

```jsonnet
local plugins = import "@c6fc/spellcraft-plugins/module.libsonnet";
local aws = plugins.aws.terraform;
local lambda = plugins.aws.terraform.lambda.config({ thisFile: std.thisFile });

{
  "providers.tf.json": {
    provider: aws.providerAliases("us-east-1"),

    terraform: {
      required_providers: {
        aws: { source: "hashicorp/aws" },
        "null": { source: "hashicorp/null" },
        "local": { source: "hashicorp/local" },
      },
    },
  },

  "worker.tf.json": lambda.nodejs_function("worker", "us-east-1", {
    timeout: 30,
    memory_size: 512,

    execution_policy_statements: [{
      Effect: "Allow",
      Action: ["s3:GetObject"],
      Resource: "arn:aws:s3:::my-bucket/*",
    }],

    execution_policy_attachments: [
      "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
    ],

    event_triggers: [{ schedule_expression: "rate(1 hour)" }],
  }),
}
```

Note `"null"` and `"local"` quoted in `required_providers`. This factory emits a `null_resource` and
a `local_file`, so that block needs both providers — and both words are **Jsonnet keywords**.
Unquoted, evaluation fails with `unexpected: null while parsing field definition`, pointing at a
line that looks perfectly correct if you read it as Terraform. Resource *types* are unaffected:
`null_resource` and `local_file` are ordinary identifiers.

#### `refs::`

Same convention as `s3.bucket()`: every resource the call built, addressable as
`"<resource_type>.<the name you passed>"`.

```jsonnet
local lambda = (import "@c6fc/spellcraft-plugins/module.libsonnet").aws.terraform.lambda.config({
  thisFile: std.thisFile,
});

local fn = lambda.nodejs_function("my_function", "us-east-1", { timeout: 30 });

{
  "lambda.tf.json": fn,

  "extra.tf.json": {
    resource: {
      aws_iam_role_policy_attachment: {
        extra: {
          // The role this call created, without knowing it is named
          // "lambda-my_function" internally.
          role: "${%s.id}" % fn.refs["aws_iam_role.my_function"]._terraform_id,
          policy_arn: "arn:aws:iam::aws:policy/AmazonSQSReadOnlyAccess",
        },
      },
    },
  },

  // A derived value nothing else exposes: "/aws/lambda/my_function".
  "log_group.json": { group: fn.refs["aws_cloudwatch_log_group.my_function"].name },
}
```

Always present: `aws_lambda_function`, `aws_iam_role`, `aws_iam_role_policy`,
`aws_cloudwatch_log_group`, `local_file` (the generated `ENVVARS`), `null_resource` (the
`npm install` step) and `data.archive_file` (the zip).

Where one option builds several resources, the entry holds them for you to index:
`aws_iam_role_policy_attachment.<name>` is keyed by policy name,
`aws_cloudwatch_event_rule.<name>` and `aws_cloudwatch_event_target.<name>` are arrays in
`event_triggers` order, and `aws_lambda_permission.<name>` is sub-keyed by the option that produced
each one. These four exist only when the options that build them do.

#### The `ENVVARS` file

The `local_file` this factory writes holds the function's environment as shell assignments, for
invoking and testing the function locally. Values are POSIX-quoted, so an apostrophe or a `$` in a
value — from `getArtifact()`, an API response, anywhere a manifest gets live values — stays a
literal. The deployed function takes its environment from the function definition, not from this
file.
