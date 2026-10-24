import { describe, expect, it } from 'vitest';
import { loadCatalog } from './catalog.js';
import { DEFAULT_PAGE_SIZE, isPaginated, requiresConfirmation } from './rules.js';
import { EFFECTS } from './types.js';

describe('requiresConfirmation', () => {
  it('is true for delete and bulk only', () => {
    expect(EFFECTS.filter(requiresConfirmation)).toEqual(['delete', 'bulk']);
  });
});

describe('isPaginated', () => {
  it('is true for operations with a maxResults query parameter', () => {
    const catalog = loadCatalog();
    const paged = catalog.operations.filter(isPaginated);
    expect(paged.length).toBeGreaterThan(50);
    expect(paged.every((operation) => operation.params.some((p) => p.name === 'maxResults'))).toBe(
      true,
    );
    expect(isPaginated({ params: [] })).toBe(false);
  });
});

describe('DEFAULT_PAGE_SIZE', () => {
  it('is 500', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(500);
  });
});
