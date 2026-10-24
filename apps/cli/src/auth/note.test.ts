import { describe, expect, it } from 'vitest';
import { OperateError } from '../errors.js';
import { withAuthNote } from './note.js';
import type { AuthProvider, Principal } from './types.js';

const NOTE = 'A bearer token is set (from OPERATE_TOKEN) but not used.';

/** A provider like the OAuth one: a class with a getter and methods that use `this`. */
class FakeOAuth implements AuthProvider {
  readonly type = 'oauth';
  readonly loginStatusCommand = 'operate auth status';
  user: string | undefined;
  constructor(private readonly failure: OperateError | undefined) {}

  get principal(): Principal | undefined {
    return this.user === undefined ? undefined : { user: this.user, source: 'login' };
  }

  headers() {
    this.user = 'alice';
    return this.failure === undefined
      ? Promise.resolve({ Authorization: 'Bearer t' })
      : Promise.reject(this.failure);
  }

  refresh() {
    return this.failure === undefined ? Promise.resolve(true) : Promise.reject(this.failure);
  }

  preview() {
    return Promise.resolve({ headers: {}, note: 'Not logged in.' });
  }

  rejectedHint(status: number) {
    return `${this.type} ${status}`;
  }
}

const loginRequired = new OperateError('LOGIN_REQUIRED', 'Not logged in', { hint: 'Log in.' });

describe('withAuthNote', () => {
  it('returns the provider itself without a note', () => {
    const provider = new FakeOAuth(undefined);
    expect(withAuthNote(provider, undefined)).toBe(provider);
  });

  it('appends the note to LOGIN_REQUIRED and the dry-run note, and exposes it', async () => {
    const noted = withAuthNote(new FakeOAuth(loginRequired), NOTE);
    expect(noted.note).toBe(NOTE);
    await expect(noted.headers()).rejects.toMatchObject({
      code: 'LOGIN_REQUIRED',
      message: 'Not logged in',
      details: { hint: `Log in. ${NOTE}` },
    });
    await expect(noted.refresh?.()).rejects.toMatchObject({ details: { hint: `Log in. ${NOTE}` } });
    await expect(noted.preview?.()).resolves.toEqual({
      headers: {},
      note: `Not logged in. ${NOTE}`,
    });
    const bare = withAuthNote(new FakeOAuth(new OperateError('LOGIN_REQUIRED', 'x')), NOTE);
    await expect(bare.headers()).rejects.toMatchObject({ details: { hint: NOTE } });
  });

  it('keeps other failures, getters and methods of the provider as they are', async () => {
    const other = new OperateError('NETWORK', 'down');
    await expect(withAuthNote(new FakeOAuth(other), NOTE).headers()).rejects.toBe(other);
    const provider = new FakeOAuth(undefined);
    const noted = withAuthNote(provider, NOTE);
    expect(noted.principal).toBeUndefined();
    await expect(noted.headers()).resolves.toEqual({ Authorization: 'Bearer t' });
    expect(noted.principal).toEqual({ user: 'alice', source: 'login' });
    await expect(noted.refresh?.()).resolves.toBe(true);
    expect(noted.rejectedHint?.(401)).toBe('oauth 401');
    expect(noted).toMatchObject({ type: 'oauth', loginStatusCommand: 'operate auth status' });
  });

  it('adds no method the provider lacks and keeps a preview without a note', async () => {
    const basic: AuthProvider = {
      type: 'basic',
      off: 'off',
      headers: () => Promise.resolve({}),
    };
    const noted = withAuthNote(basic, NOTE);
    expect('refresh' in noted).toBe(false);
    expect('rejectedHint' in noted).toBe(false);
    expect(noted.off).toBe('off');
    await expect(noted.preview?.()).resolves.toEqual({ headers: {} });
  });
});
