import { describe, expect, test } from 'vitest';
import { EngineCliEnvironment } from '../../../../src/adapters/c7/engine-cli/index.js';

const CONNECTION = {
  url: 'https://engine.example/engine-rest',
  credentials: { kind: 'basic', username: 'demo', password: 's3cret' },
  configPath: '/tmp/pulse/engine-cli-config.json',
} as const;

describe('the environment of the engine CLI process', () => {
  test('keeps what corporate networks need and drops what changes the runtime or its TLS checks', () => {
    const environment = EngineCliEnvironment.of(CONNECTION, {
      PATH: '/usr/bin',
      HOME: '/home/dev',
      HTTP_PROXY: 'http://proxy:3128',
      https_proxy: 'http://proxy:3128',
      NO_PROXY: 'localhost',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/corporate.pem',
      node_use_system_ca: '1',
      NODE_OPTIONS: '--require /tmp/hook.js',
      node_options: '--inspect',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      NODE_DEBUG: 'tls',
      NODE_PATH: '/tmp/modules',
      LD_PRELOAD: '/tmp/hook.so',
      DYLD_INSERT_LIBRARIES: '/tmp/hook.dylib',
      OPERATE_TOKEN_COMMAND: 'cat /tmp/token',
      operate_url: 'http://other.example',
      UNSET: undefined,
    });

    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/dev',
      HTTP_PROXY: 'http://proxy:3128',
      https_proxy: 'http://proxy:3128',
      NO_PROXY: 'localhost',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/corporate.pem',
      node_use_system_ca: '1',
      ELECTRON_RUN_AS_NODE: '1',
      OPERATE_URL: 'https://engine.example/engine-rest',
      OPERATE_OUTPUT: 'json',
      OPERATE_READ_ONLY: '1',
      OPERATE_CONFIG: '/tmp/pulse/engine-cli-config.json',
      OPERATE_AUTH: 'basic',
      OPERATE_USERNAME: 'demo',
      OPERATE_PASSWORD: 's3cret',
    });
  });
});
