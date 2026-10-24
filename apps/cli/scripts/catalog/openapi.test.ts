import { describe, expect, it } from 'vitest';
import { isReference, refName, resolve } from './openapi.js';

describe('isReference', () => {
  it.each([
    [{ $ref: '#/components/schemas/A' }, true],
    [{ $ref: 1 }, false],
    [{ name: 'a' }, false],
    [null, false],
    ['#/components/schemas/A', false],
  ])('isReference(%j) is %s', (value, expected) => {
    expect(isReference(value)).toBe(expected);
  });
});

describe('refName', () => {
  it('returns the component name of a local reference', () => {
    expect(refName('#/components/schemas/TaskDto')).toBe('TaskDto');
    expect(refName('#/components/parameters/tenantId')).toBe('tenantId');
  });

  it.each([
    'https://example.com/spec.json#/components/schemas/A',
    '#/definitions/A',
    '#/components/schemas/',
  ])('rejects %s', (ref) => {
    expect(() => refName(ref)).toThrow(new Error(`Unsupported $ref: ${ref}`));
  });
});

describe('resolve', () => {
  const components = { A: { name: 'a' } };

  it('returns inline values unchanged', () => {
    const inline = { name: 'inline' };
    expect(resolve(inline, components)).toBe(inline);
  });

  it('looks up references in the components', () => {
    expect(resolve({ $ref: '#/components/parameters/A' }, components)).toBe(components.A);
  });

  it('fails for unknown references or missing components', () => {
    expect(() => resolve({ $ref: '#/components/parameters/B' }, components)).toThrow(
      new Error('Unresolvable $ref: #/components/parameters/B'),
    );
    expect(() => resolve({ $ref: '#/components/parameters/A' }, undefined)).toThrow(
      new Error('Unresolvable $ref: #/components/parameters/A'),
    );
  });
});
