#!/usr/bin/env node

/*
	Reads @c6fc/spellcraft-plugins, checked out beside this site, and writes
	src/data/plugins.json -- one entry per node in its tree.

	The site build consumes the committed JSON, not this script, so the site
	builds anywhere. Re-run it after publishing and commit the result -- that
	is the whole maintenance story for the plugin index.

	Usage: npm run plugins
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKSPACE = path.resolve(__dirname, '..', '..');
const PACKAGE = path.resolve(WORKSPACE, 'spellcraft-plugins');
const OUT = path.resolve(__dirname, '..', 'src', 'data', 'plugins.json');

// The seven plugins are one package now, and its Jsonnet surface is a tree of
// nodes rather than a list of packages. The index still presents one card per
// node -- that is the unit a reader installs against, even though it is no
// longer the unit npm ships -- so this walks the tree instead of walking
// sibling repos.
//
// Order the index presents them in: providers, then lifecycle, then leaves,
// then the provider-agnostic utilities.
const ORDER = [
	'aws/auth',
	'gcp/auth',
	'terraform',
	'aws/terraform',
	'gcp/terraform',
	'aws/terraform/s3',
	'aws/terraform/lambda',
	'utils/tree',
	'utils/merge'
];

// Each node's README opens with its H1 and then a one-paragraph summary. That
// paragraph is the description -- derived rather than duplicated, so the card
// and the README cannot drift.
function describeNode(readme) {
	if (!readme) return '';

	const lines = readme.split('\n');
	const start = lines.findIndex((line) => line.startsWith('# ')) + 1;

	const paragraph = [];
	for (const line of lines.slice(start)) {
		if (line.startsWith('[![') || (paragraph.length === 0 && line.trim() === '')) continue;
		if (line.trim() === '') break;
		paragraph.push(line.trim());
	}

	// Cards render this as plain text, so flatten inline links to their label.
	return paragraph.join(' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

// Sibling nodes this one reaches. The old cards showed cross-package
// dependencies; these are the same relationships, now internal to one package,
// and they show up two ways: a relative import/require, or a std.native() call
// whose id names another node (which is how the pure-Jsonnet leaves reach the
// auth nodes without any import at all).
function nodeRequires(node, moduleJs, libsonnet, order) {
	const found = new Set();
	const from = path.join(PACKAGE, node);
	const self = node.split('/').join('.');

	for (const source of [moduleJs, libsonnet]) {
		if (!source) continue;

		for (const [, target] of source.matchAll(/(?:import|require\()\s*["'](\.\.[^"')]*)["']/g)) {
			const resolved = path.resolve(from, target.replace(/\/module\.libsonnet$/, ''));
			const rel = path.relative(PACKAGE, resolved);

			if (rel && !rel.startsWith('..')) found.add(rel.split(path.sep).join('.'));
		}
	}

	if (libsonnet) {
		for (const [, id] of libsonnet.matchAll(/std\.native\(\s*["'][^:"']+:([^"']+)["']\s*\)/g)) {
			const owner = order.find((candidate) => id.startsWith(`${candidate}.`));
			if (owner) found.add(owner);
		}
	}

	found.delete(self);

	return [...found].sort();
}

function read(file) {
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

// cliExtensions registers commands with yargs; count the .command() calls.
function countCommands(moduleJs) {
	if (!moduleJs) return 0;

	return (moduleJs.match(/\.command\s*\(/g) || []).length;
}

function describeMetadata(moduleJs) {
	if (!moduleJs) return { init: false, events: false, hooks: false };

	return {
		init: /\binit\s*:/.test(moduleJs),
		events: /\.emit(?:Async)?\s*\(/.test(moduleJs),
		hooks: /spellframe\.on\s*\(|\bon\s*\(\s*['"`]@c6fc/.test(moduleJs)
	};
}

const plugins = [];

const pkg = JSON.parse(read(path.join(PACKAGE, 'package.json')) || 'null');

if (!pkg) {
	console.error('[!] spellcraft-plugins is not checked out beside the site.');
	process.exit(1);
}

const repository = (pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');

for (const node of ORDER) {
	const root = path.join(PACKAGE, node);

	if (!fs.existsSync(root)) {
		console.warn(`[!] ${node} is not present in spellcraft-plugins; skipping.`);
		continue;
	}

	const moduleJs = read(path.join(root, 'index.js'));
	const libsonnet = read(path.join(root, 'module.libsonnet'));
	const meta = describeMetadata(moduleJs);
	const dotted = node.split('/').join('.');

	plugins.push({
		name: `plugins.${dotted}`,
		short: dotted,
		version: pkg.version,
		description: describeNode(read(path.join(root, 'README.md'))),
		commands: countCommands(moduleJs),
		pureJsonnet: !moduleJs,
		init: meta.init,
		emitsEvents: meta.events,
		hooksEvents: meta.hooks,
		requires: nodeRequires(node, moduleJs, libsonnet, ORDER.map((n) => n.split('/').join('.'))),
		repository: repository ? `${repository}/tree/main/${node}` : '',
		npm: `https://www.npmjs.com/package/${pkg.name}`,

		// Where this node is documented. The index and the home page both link
		// into the group page rather than repeating the node list, and the
		// anchor is the node's own dotted name -- scripts/rehype-node-anchors.mjs
		// gives the `## aws.auth` heading that id instead of the slugged one.
		group: node.split('/')[0],
		page: `/plugins/${node.split('/')[0]}.html`,
		anchor: dotted
	});
}

const corePkg = JSON.parse(read(path.join(WORKSPACE, 'spellcraft', 'package.json')));

const output = {
	version: corePkg.version,
	package: pkg.name,
	install: `npm install --save ${pkg.name}`,
	packageVersion: pkg.version,
	generated: new Date().toISOString().slice(0, 10),
	plugins
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);

console.log(`[+] Wrote ${path.relative(process.cwd(), OUT)} — core ${output.version}, ${plugins.length} plugins.`);
for (const plugin of plugins) {
	console.log(`      ${plugin.short.padEnd(20)} ${plugin.version.padEnd(8)} ${plugin.commands} cmd${plugin.pureJsonnet ? ', pure Jsonnet' : ''}`);
}
