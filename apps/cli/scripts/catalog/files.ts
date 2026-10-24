/** Locations of the vendored spec, its patches, the engine patches and the generated catalogs. */

import { readFileSync } from 'node:fs';
import type { OpenApiDocument } from './openapi.js';
import { patchedSpec } from './render.js';

export const SPEC_FILE = new URL('../../spec/camunda7-rest/api.json', import.meta.url);
export const PATCH_FILE = new URL('../../spec/camunda7-rest/patches.json', import.meta.url);

/** The engines with an adapter in src/engines, each with its own patches and catalog. */
export const ENGINES = ['operaton', 'cibseven', 'camunda7'] as const;
export type Engine = (typeof ENGINES)[number];

export function enginePatchFile(engine: Engine): URL {
  return new URL(`../../spec/engines/${engine}.patches.json`, import.meta.url);
}

export function catalogFile(engine: Engine): URL {
  return new URL(`../../src/generated/catalog.${engine}.json`, import.meta.url);
}

/** The vendored spec with `spec/camunda7-rest/patches.json` applied. */
export function readPatchedSpec(): OpenApiDocument {
  return patchedSpec(readFileSync(SPEC_FILE, 'utf8'), readFileSync(PATCH_FILE, 'utf8'));
}
