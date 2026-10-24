import { describe, expect, it } from 'vitest';
import { noAuth } from './none.js';

describe('noAuth', () => {
  it('has type none', () => {
    expect(noAuth().type).toBe('none');
  });

  it('adds no headers', async () => {
    await expect(noAuth().headers()).resolves.toEqual({});
  });

  it('says why no credentials are sent only when given a reason', () => {
    expect('off' in noAuth()).toBe(false);
    expect(noAuth('Basic auth is switched off by --auth none').off).toBe(
      'Basic auth is switched off by --auth none',
    );
  });

  it('cannot refresh credentials', () => {
    expect('refresh' in noAuth()).toBe(false);
  });
});
