import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		part: z.string(),
		chapter: z.number(),
		order: z.number()
	})
});

// The plugin reference. One page per top-level group, each covering that
// group's nodes -- the unit a reader installs against is the package, so the
// index sells the group and the page documents every method in it.
const pluginDocs = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/plugins' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		group: z.string(),
		nodes: z.array(z.string()),
		order: z.number()
	})
});

export const collections = { docs, pluginDocs };
