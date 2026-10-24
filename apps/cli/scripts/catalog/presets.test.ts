import { describe, expect, it } from 'vitest';
import type { BodySpec, Catalog, OperationSpec } from '../../src/catalog/types.js';
import { buildCatalog } from './build-catalog.js';
import { readPatchedSpec } from './files.js';
import { PRESETS, applyPresets } from './presets.js';
import { SPEC_URL } from './render.js';

const SUSPENDED_BODY: BodySpec = {
  kind: 'json',
  schema: {},
  fields: [
    { name: 'suspended', flag: 'suspended', type: 'boolean', description: '' },
    { name: 'note', flag: 'note', type: 'string', description: '' },
  ],
  variableMaps: [],
  variableValue: false,
};

function operation(operationId: string, body?: BodySpec): OperationSpec {
  return {
    operationId,
    group: 'thing',
    name: `update-${operationId}`,
    aliases: ['alias'],
    method: 'PUT',
    path: `/thing/{id}/${operationId}`,
    summary: 'Update',
    description: 'Original description',
    deprecated: false,
    effect: 'write',
    engineScoped: true,
    params: [],
    responses: [],
    ...(body === undefined ? {} : { body }),
  };
}

const IDS = [
  'updateSuspensionStateById',
  'updateProcessDefinitionSuspensionStateById',
  'updateJobSuspensionState',
  'updateSuspensionStateJobDefinition',
  'updateBatchSuspensionState',
];

describe('PRESETS', () => {
  it('defines suspend and activate for every suspendable resource', () => {
    expect(PRESETS.map((preset) => `${preset.operationId} ${preset.name}`)).toEqual(
      IDS.flatMap((id) => [`${id} suspend`, `${id} activate`]),
    );
    expect(PRESETS[0]).toEqual({
      operationId: 'updateSuspensionStateById',
      name: 'suspend',
      summary: 'Suspend a process instance',
      body: { suspended: true },
    });
    expect(PRESETS[9]).toEqual({
      operationId: 'updateBatchSuspensionState',
      name: 'activate',
      summary: 'Activate a batch',
      body: { suspended: false },
    });
  });
});

const MULTIPART: BodySpec = { kind: 'multipart', fields: [], resources: false };

const BASE = [
  operation(IDS[0] ?? '', SUSPENDED_BODY),
  operation(IDS[1] ?? ''),
  operation(IDS[2] ?? '', MULTIPART),
  operation(IDS[3] ?? '', SUSPENDED_BODY),
  operation(IDS[4] ?? '', SUSPENDED_BODY),
];

/** Applies the presets inside the calling test, so mutation testing attributes the coverage to it. */
function presetsOf(base: readonly OperationSpec[]): OperationSpec[] {
  return applyPresets(base).slice(base.length);
}

describe('applyPresets', () => {
  it('appends one command per preset and keeps the base operations', () => {
    const result = applyPresets(BASE);
    expect(result.slice(0, BASE.length)).toEqual(BASE);
    expect(result).toHaveLength(BASE.length + PRESETS.length);
  });

  it('derives the preset command from its base operation', () => {
    expect(presetsOf(BASE)[0]).toEqual({
      ...BASE[0],
      name: 'suspend',
      aliases: [],
      summary: 'Suspend a process instance',
      description:
        'Suspend a process instance. Shortcut for `thing update-updateSuspensionStateById` with {"suspended":true}.',
      body: { ...SUSPENDED_BODY, fields: [SUSPENDED_BODY.fields[1]] },
      preset: { suspended: true },
    });
  });

  it('leaves bodies other than JSON untouched and adds no body where there is none', () => {
    const presets = presetsOf(BASE);
    expect(presets[2]).not.toHaveProperty('body');
    expect(presets[4]?.body).toBe(MULTIPART);
  });

  it('does not modify the base operations', () => {
    presetsOf(BASE);
    expect(BASE[0]?.body).toBe(SUSPENDED_BODY);
    expect(SUSPENDED_BODY.fields).toHaveLength(2);
  });

  it('fails when a preset refers to an unknown operation', () => {
    expect(() => applyPresets(BASE.slice(1))).toThrow(
      new Error('Preset for unknown operation updateSuspensionStateById'),
    );
  });
});

let cachedCatalog: Catalog | undefined;

/**
 * The catalog built from the vendored spec. Built lazily inside the first test that needs it, never
 * at load time, so mutation testing attributes the generator code to tests.
 */
function realCatalog(): Catalog {
  cachedCatalog ??= buildCatalog(readPatchedSpec(), SPEC_URL);
  return cachedCatalog;
}

describe('presets in the generated catalog', () => {
  it.each([
    ['process-instance', 'update-suspension-state-by-id'],
    ['process-definition', 'update-suspension-state-by-id'],
    ['job', 'update-suspension-state-by-id'],
    ['job-definition', 'update-suspension-state-by-id'],
    ['batch', 'update-suspension-state-by-id'],
  ])('offers suspend and activate in %s next to %s', (group, baseName) => {
    const commands = realCatalog().operations.filter((operation) => operation.group === group);
    const suspend = commands.find((operation) => operation.name === 'suspend');
    const activate = commands.find((operation) => operation.name === 'activate');
    const original = commands.find((operation) => operation.name === baseName);
    expect(suspend?.preset).toEqual({ suspended: true });
    expect(activate?.preset).toEqual({ suspended: false });
    expect(suspend?.operationId).toBe(original?.operationId);
    expect(suspend?.body?.fields.map((field) => field.name)).not.toContain('suspended');
    expect(original?.body?.fields.map((field) => field.name)).toContain('suspended');
  });
});
