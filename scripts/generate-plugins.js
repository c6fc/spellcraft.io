#!/usr/bin/env node

/*
	Reads the SpellCraft packages checked out beside this site and writes
	src/data/plugins.json.

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
const OUT = path.resolve(__dirname, '..', 'src', 'data', 'plugins.json');

// Order the index presents them in: providers, then lifecycle, then leaves.
const ORDER = [
	'spellcraft-aws-auth',
	'spellcraft-gcp-auth',
	'spellcraft-terraform',
	'spellcraft-aws-terraform',
	'spellcraft-gcp-terraform',
	'spellcraft-aws-s3',
	'spellcraft-aws-lambda'
];

function read(file) {
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

// Top-level members of the libsonnet object are what users can call. They sit
// at exactly one tab or two spaces -- nested helpers and hidden `::` fields are
// indented further -- and may be declared with either `:` or `::`.
//
// A libsonnet that is a bare expression rather than an object (spellcraft-
// terraform exposes one native call directly) has no members but is itself one
// callable thing.
function countExports(libsonnet) {
	if (!libsonnet) return 0;

	const names = new Set();
	const pattern = /^(?:\t|  )([A-Za-z_][\w]*)\s*(?:\([^)]*\))?\s*::?(?!:)/gm;

	let match;
	while ((match = pattern.exec(libsonnet)) !== null) names.add(match[1]);

	if (names.size === 0 && /std\.native\(/.test(libsonnet)) return 1;

	return names.size;
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

for (const dir of ORDER) {
	const root = path.join(WORKSPACE, dir);
	const manifest = read(path.join(root, 'package.json'));

	if (!manifest) {
		console.warn(`[!] ${dir} is not checked out beside the site; skipping.`);
		continue;
	}

	const pkg = JSON.parse(manifest);
	const moduleJs = read(path.join(root, pkg.main || 'module.js'));
	const libsonnet = read(path.join(root, 'module.libsonnet'));
	const meta = describeMetadata(moduleJs);

	const requires = Object.keys({ ...pkg.peerDependencies, ...pkg.dependencies })
		.filter((dep) => dep.startsWith('@c6fc/spellcraft-'));

	plugins.push({
		name: pkg.name,
		short: dir.replace(/^spellcraft-/, ''),
		version: pkg.version,
		description: pkg.description,
		functions: countExports(libsonnet),
		commands: countCommands(moduleJs),
		pureJsonnet: !moduleJs || !/exports\.[A-Za-z_]/.test(moduleJs.replace(/exports\._spellcraft_metadata/g, '')),
		init: meta.init,
		emitsEvents: meta.events,
		hooksEvents: meta.hooks,
		requires,
		repository: (pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, ''),
		npm: `https://www.npmjs.com/package/${pkg.name}`,
		install: `npm install --save ${pkg.name}`
	});
}

const corePkg = JSON.parse(read(path.join(WORKSPACE, 'spellcraft', 'package.json')));

const output = {
	version: corePkg.version,
	generated: new Date().toISOString().slice(0, 10),
	plugins
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);

console.log(`[+] Wrote ${path.relative(process.cwd(), OUT)} — core ${output.version}, ${plugins.length} plugins.`);
for (const plugin of plugins) {
	console.log(`      ${plugin.short.padEnd(16)} ${plugin.version.padEnd(8)} ${plugin.functions} fn, ${plugin.commands} cmd`);
}
