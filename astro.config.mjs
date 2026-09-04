// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
	site: 'https://spellcraft.io',

	// Emit /docs/cli.html rather than /docs/cli/index.html.
	//
	// S3 only resolves a directory to its index document when the bucket is
	// served through the website endpoint. Behind CloudFront pointed at the REST
	// endpoint — the usual setup — a request for /docs/cli/ finds no such key,
	// falls through to the error document, and serves the home page instead.
	// Explicit .html keys work on every static host.
	build: { format: 'file' },

	markdown: {
		shikiConfig: { theme: 'github-light', wrap: false }
	},
	devToolbar: { enabled: false }
});
