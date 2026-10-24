/**
 * Every query parameter flag of every operation, parsed by the real program (root options,
 * global options and lazy registration included), must reach the request under its wire name. A
 * flag swallowed by another option (the root `--version`) fails here, not in an agent session.
 */

import { describe, expect, it } from 'vitest';
import { execute, fakeRuntime } from '../../test/support/fake-runtime.js';
import { loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec, ParamSpec } from '../catalog/types.js';
import { normalizeDateTime } from '../operation/dates.js';
import { run } from './run.js';

const catalog = loadCatalog();

const SAMPLES: Readonly<Record<string, string>> = { integer: '7', number: '1.5' };

/** `--x` (true) for presence flags, else `--no-x` (false). */
function booleanSample(param: ParamSpec): { words: string[]; expected: string } {
  const negatable = param.trueOnly !== true && !param.flag.startsWith('no-');
  return negatable
    ? { words: [`--no-${param.flag}`], expected: 'false' }
    : { words: [`--${param.flag}`], expected: 'true' };
}

/** The flag words for a parameter and the value the request must carry. */
function sample(param: ParamSpec): { words: string[]; expected: string } {
  if (param.type === 'boolean') return booleanSample(param);
  if (param.enum !== undefined) {
    const [choice = ''] = param.enum;
    return { words: [`--${param.flag}`, choice], expected: choice };
  }
  if (param.format === 'date-time') {
    return { words: [`--${param.flag}`, '2024-05-01'], expected: normalizeDateTime('2024-05-01') };
  }
  const value = SAMPLES[param.type] ?? `v-${param.flag}`;
  return { words: [`--${param.flag}`, value], expected: value };
}

function requiredWords(operation: OperationSpec, except: ParamSpec): string[] {
  return operation.params
    .filter((param) => param.in === 'query' && param.required && param !== except)
    .flatMap((param) => sample(param).words);
}

function cases(): [string, OperationSpec, ParamSpec][] {
  return catalog.operations
    .filter((operation) => operation.body?.kind !== 'multipart')
    .flatMap((operation) =>
      operation.params
        .filter((param) => param.in === 'query')
        .map((param): [string, OperationSpec, ParamSpec] => [
          `${operation.group} ${operation.name} --${param.flag}`,
          operation,
          param,
        ]),
    );
}

/** Runs one flag through the program; returns a failure line, or undefined when it arrived. */
async function check([label, operation, param]: [string, OperationSpec, ParamSpec]) {
  const pathArgs = operation.params.filter((p) => p.in === 'path').map((p) => p.enum?.[0] ?? 'p1');
  const { words, expected } = sample(param);
  const args = [
    operation.group,
    operation.name,
    ...pathArgs,
    ...words,
    ...requiredWords(operation, param),
    ...(operation.body?.kind === 'json' ? ['--no-validate'] : []),
    '--dry-run',
  ];
  const result = await execute(run, args, fakeRuntime());
  const url = result.code === 0 ? (JSON.parse(result.stdout) as { url: string }).url : '';
  const actual = url === '' ? undefined : new URL(url).searchParams.get(param.name);
  return actual === expected ? undefined : `${label}: ${actual ?? result.stderr}`;
}

const all = cases();
const groups = [...new Set(all.map(([, operation]) => operation.group))];

describe('query flags parsed by the real program', () => {
  it('cover every query parameter of the catalog', () => {
    expect(all.length).toBeGreaterThan(900);
  });

  // One test per group keeps each test fast on slow CI runners and names the broken group.
  it.each(groups)('reach the request under their wire names: %s', async (group) => {
    const failed: string[] = [];
    for (const entry of all.filter(([, operation]) => operation.group === group)) {
      const failure = await check(entry);
      if (failure !== undefined) failed.push(failure);
    }
    expect(failed).toEqual([]);
  });
});
