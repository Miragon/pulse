/**
 * Regenerates `src/generated/catalog.<engine>.json` for every engine from the vendored OpenAPI
 * spec, `spec/camunda7-rest/patches.json` and `spec/engines/<engine>.patches.json`.
 * Usage: npm run generate [-- --check]
 * With --check the script fails if a committed catalog is out of date instead of writing it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { catalogFile, ENGINES, enginePatchFile, PATCH_FILE, SPEC_FILE } from './catalog/files.js';
import { renderCatalog } from './catalog/render.js';

const specText = await readFile(SPEC_FILE, 'utf8');
const patchText = await readFile(PATCH_FILE, 'utf8');
for (const engine of ENGINES) {
  const file = catalogFile(engine);
  const rendered = renderCatalog(
    specText,
    patchText,
    await readFile(enginePatchFile(engine), 'utf8'),
  );
  if (process.argv.includes('--check')) {
    const current = await readFile(file, 'utf8').catch(() => '');
    if (current !== rendered) {
      console.error(
        `src/generated/catalog.${engine}.json is out of date. Run \`npm run generate\`.`,
      );
      process.exitCode = 1;
    }
  } else {
    await writeFile(file, rendered);
    console.log(`Wrote ${file.pathname}`);
  }
}
