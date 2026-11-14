/**
 * `pnpm directory:validate` — checks every `directory/servers/*.json` entry and that
 * `directory/schema.json` matches the zod schema, and the icons in `directory/icons/` (each
 * referenced, square PNG, small). `--write` regenerates `schema.json`.
 * Runs with plain Node (type stripping), no build step. Exit code 1 on any issue (CI gate).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	directoryJsonSchema,
	validateDirectory
} from '../src/lib/server/connectors/directory-schema.ts';

const root = import.meta.dirname;
const serversDir = join(root, 'servers');
const iconsDir = join(root, 'icons');
const schemaPath = join(root, 'schema.json');

const files = readdirSync(serversDir)
	.filter((name) => !name.startsWith('.'))
	.map((name) => ({ name, content: readFileSync(join(serversDir, name), 'utf8') }));

const icons = new Map(
	readdirSync(iconsDir)
		.filter((name) => !name.startsWith('.'))
		.map((name) => [name, new Uint8Array(readFileSync(join(iconsDir, name)))] as const)
);

const { entries, issues } = validateDirectory(files, icons);

const schema = `${JSON.stringify(directoryJsonSchema(), null, '\t')}\n`;
if (process.argv.includes('--write')) {
	writeFileSync(schemaPath, schema);
	console.log('Wrote directory/schema.json');
} else if (
	// Compared as data: prettier may reflow the committed file
	JSON.stringify(JSON.parse(readFileSync(schemaPath, 'utf8'))) !==
	JSON.stringify(JSON.parse(schema))
) {
	issues.push({
		file: 'schema.json',
		message: 'Out of date: run `pnpm directory:validate --write`.'
	});
}

if (issues.length > 0) {
	for (const issue of issues) console.error(`✗ ${issue.file}: ${issue.message}`);
	console.error(`\n${issues.length} issue(s) in the directory.`);
	process.exit(1);
}
console.log(`✓ ${entries.length} directory entries are valid.`);
