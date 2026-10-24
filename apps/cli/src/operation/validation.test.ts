import { describe, expect, it } from 'vitest';
import { findByOperationId, loadCatalog } from '../catalog/catalog.js';
import type { OperationSpec } from '../catalog/types.js';
import { OperateError } from '../errors.js';
import { checkBody } from './validation.js';

const catalog = loadCatalog();

function op(operationId: string): OperationSpec {
  const operation = findByOperationId(catalog, operationId);
  if (operation === undefined) throw new Error(`unknown operation ${operationId}`);
  return operation;
}

function caught(action: () => unknown): OperateError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(OperateError);
    return error as OperateError;
  }
  throw new Error('expected an error');
}

const start = op('startProcessInstanceByKey');

describe('checkBody', () => {
  it('accepts valid bodies', () => {
    expect(() => {
      checkBody(start, { pathArgs: ['k'], query: {}, body: { businessKey: 'b' } }, catalog.schemas);
    }).not.toThrow();
  });

  it('skips operations without a JSON body', () => {
    expect(() => {
      checkBody(op('getProcessInstances'), { pathArgs: [], query: {}, body: 5 }, catalog.schemas);
    }).not.toThrow();
    expect(() => {
      checkBody(op('createDeployment'), { pathArgs: [], query: {}, body: 5 }, catalog.schemas);
    }).not.toThrow();
  });

  it('reports problems as a VALIDATION error with all problems in data', () => {
    const error = caught(() => {
      checkBody(start, { pathArgs: ['k'], query: {}, body: { businesKey: 'b' } }, catalog.schemas);
    });
    expect(error.code).toBe('VALIDATION');
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe(
      'Invalid request body: $: unknown property "businesKey", did you mean "businessKey"?',
    );
    expect(error.details.hint).toBe(
      'Run `operate describe process-definition start` to see the body schema, or pass --no-validate to skip this check.',
    );
    expect(error.details.data).toEqual([
      { path: '$', message: 'unknown property "businesKey", did you mean "businessKey"?' },
    ]);
  });

  it('validates the body with merged variables', () => {
    const error = caught(() => {
      checkBody(
        start,
        { pathArgs: ['k'], query: {}, body: {}, variables: { a: { value: 1, type: 2 } as never } },
        catalog.schemas,
      );
    });
    expect(error.message).toBe('Invalid request body: variables.a.type: expected string, got 2');
  });

  it('lists five problems and counts the rest', () => {
    const body = Object.fromEntries(
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map((key) => [key, 1]),
    );
    const error = caught(() => {
      checkBody(start, { pathArgs: ['k'], query: {}, body }, catalog.schemas);
    });
    expect(error.message).toBe(
      'Invalid request body: $: unknown property "a1"; $: unknown property "a2"; $: unknown property "a3"; $: unknown property "a4"; $: unknown property "a5" (and 2 more)',
    );
    expect(error.details.data).toHaveLength(7);
  });

  it('lists exactly five problems without a remainder', () => {
    const body = Object.fromEntries(['a1', 'a2', 'a3', 'a4', 'a5'].map((key) => [key, 1]));
    const error = caught(() => {
      checkBody(start, { pathArgs: ['k'], query: {}, body }, catalog.schemas);
    });
    expect(error.message).toBe(
      'Invalid request body: $: unknown property "a1"; $: unknown property "a2"; $: unknown property "a3"; $: unknown property "a4"; $: unknown property "a5"',
    );
  });

  it('lists six problems with one more', () => {
    const body = Object.fromEntries(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((key) => [key, 1]));
    expect(
      caught(() => {
        checkBody(start, { pathArgs: ['k'], query: {}, body }, catalog.schemas);
      }).message,
    ).toMatch(/"a5" \(and 1 more\)$/);
  });
});
