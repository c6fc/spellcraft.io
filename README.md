# spellcraft.io

The website for [SpellCraft](https://github.com/c6fc/spellcraft). An Astro static
site: no server, no client-side framework, plain HTML out.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # regenerates plugin data, then builds to dist/
./sync.sh s3://your-bucket
```

## Layout

| path | what it is |
|---|---|
| `src/pages/` | routes — `index.astro`, `plugins.astro`, `docs/[...slug].astro` |
| `src/content/docs/` | the documentation, one Markdown file per chapter |
| `src/layouts/` | `Base.astro` for marketing pages, `Docs.astro` for chapters |
| `src/styles/global.css` | the whole design system, as CSS custom properties |
| `src/data/plugins.json` | **generated** — see below |
| `scripts/generate-plugins.js` | writes that file from the packages next door |
| `design/` | the Claude Design canvas the visual direction came from |

## Deployment: why URLs end in `.html`

`astro.config.mjs` sets `build.format: 'file'`, so a page is emitted as
`docs/cli.html` rather than `docs/cli/index.html`.

S3 only resolves a directory to its index document when the bucket is served
through the **website** endpoint. Behind CloudFront pointed at the REST endpoint
— the usual setup — a request for `/docs/cli/` matches no key, falls through to
the error document, and quietly serves the home page instead. Explicit `.html`
keys work on every static host, with no bucket configuration to get right.

The tradeoff: a hand-typed `/docs/cli` without the extension is a 404. Nothing
on the site links that way, but it is worth knowing before sharing a URL.

## The design

"Field Manual": editorial typography on a paper ground with one terracotta
accent. Literata for display, Source Sans 3 for body, Source Code Pro for code.
Every colour and face is a custom property at the top of `global.css` — change
them there and the whole site follows.

## Adding a documentation chapter

Drop a Markdown file in `src/content/docs/` with this frontmatter:

```yaml
---
title: Lifecycle events
description: One sentence, shown as the standfirst and as the meta description.
part: Part II · Concepts
chapter: 4
order: 7
---
```

`order` sorts the sidebar and drives the previous/next pager. `part` groups the
sidebar — reuse the exact string of an existing part to join it. The filename
becomes the URL. Nothing else needs touching.

For an editorial callout, write raw HTML in the Markdown:

```html
<div class="note">
<div class="label">Constraint</div>
<strong>Arguments must be primitives</strong>
<p>…</p>
</div>
```

Add `class="note plain"` for the quieter grey variant.

## The plugin index is generated

`npm run plugins` reads every SpellCraft package checked out beside this
directory and writes `src/data/plugins.json` — versions, descriptions, function
and command counts, event participation, and cross-plugin requirements, all read
from the real `package.json` and `module.libsonnet`.

**Commit the generated file.** The site build reads the JSON, not the packages,
so it builds anywhere; the script only needs to run where the sibling repos are
checked out. Re-run it after publishing and commit the result.

`npm run build` runs it first, which means a build on this machine always picks
up the current state.
