import { describe, expect, it } from 'vitest';
import { fakeRuntime } from '../../test/support/fake-runtime.js';
import { authDeps, oauthConfig } from '../../test/support/oauth.js';
import type { AuthConfig } from '../config/types.js';
import { OperateError } from '../errors.js';
import { createAuthProvider } from './index.js';

const deps = authDeps(fakeRuntime());

describe('createAuthProvider', () => {
  it('creates the none provider', async () => {
    const provider = createAuthProvider({ type: 'none' }, deps);
    expect(provider.type).toBe('none');
    await expect(provider.headers()).resolves.toEqual({});
    expect(provider.principal).toBeUndefined();
    expect(provider.off).toBeUndefined();
    expect(createAuthProvider({ type: 'none', off: 'switched off' }, deps).off).toBe(
      'switched off',
    );
  });

  it('creates the basic provider', async () => {
    const provider = createAuthProvider(
      {
        type: 'basic',
        username: 'demo',
        password: 'demo',
        sources: { username: 'env', password: 'env' },
      },
      deps,
    );
    expect(provider.type).toBe('basic');
    await expect(provider.headers()).resolves.toEqual({ Authorization: 'Basic ZGVtbzpkZW1v' });
    expect(provider.principal).toEqual({ user: 'demo', source: 'env' });
  });

  it('creates the OAuth provider, which reads the token cache only when asked', async () => {
    const runtime = fakeRuntime();
    const provider = createAuthProvider(oauthConfig(), authDeps(runtime));
    expect(provider.type).toBe('oauth');
    expect(provider.principal).toBeUndefined();
    expect(typeof provider.refresh).toBe('function');
    await expect(provider.headers()).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(runtime.loopback.listens).toEqual([]);
    expect(runtime.browserUrls).toEqual([]);
  });

  it.each(['constructor', 'NONE', '', 'OAuth'])('rejects the unsupported type %j', (type) => {
    try {
      createAuthProvider({ type } as unknown as AuthConfig, deps);
    } catch (error) {
      expect(error).toBeInstanceOf(OperateError);
      expect((error as OperateError).code).toBe('CONFIG');
      expect((error as OperateError).exitCode).toBe(3);
      expect((error as OperateError).message).toBe(`Unsupported auth type "${type}"`);
      expect((error as OperateError).details.hint).toBe('Supported: none, basic, oauth, bearer.');
      return;
    }
    throw new Error('expected an error');
  });
});
