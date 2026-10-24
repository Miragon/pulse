import { describe, expect, it } from 'vitest';
import { CONFIG_PATH, execute, fakeRuntime } from '../../test/support/fake-runtime.js';
import { selectEngine } from './platform.js';
import { run } from './run.js';

const PROFILES = JSON.stringify({
  defaultProfile: 'local',
  profiles: { local: { platform: 'operaton' }, other: { platform: 'cibseven' } },
});

async function engineOf(argv: readonly string[], env: Record<string, string> = {}) {
  const runtime = fakeRuntime({ env, files: { [CONFIG_PATH]: PROFILES } });
  return (await selectEngine(argv, runtime)).name;
}

describe('selectEngine', () => {
  it('takes --platform, then OPERATE_PLATFORM, then the selected profile', async () => {
    const env = { OPERATE_PLATFORM: 'camunda7' };
    expect(await engineOf(['ping', '--platform', 'cibseven'], env)).toBe('cibseven');
    expect(await engineOf(['ping'], env)).toBe('camunda7');
    expect(await engineOf(['ping'])).toBe('operaton');
    expect(await engineOf(['ping', '--profile', 'other'])).toBe('cibseven');
    expect(await engineOf(['ping'], { OPERATE_PROFILE: 'other' })).toBe('cibseven');
  });

  it('uses camunda7 without a platform and when the config cannot be read', async () => {
    expect((await selectEngine(['ping'], fakeRuntime())).name).toBe('camunda7');
    expect(await engineOf(['ping', '--profile', 'missing'])).toBe('camunda7');
    const broken = fakeRuntime({ files: { [CONFIG_PATH]: '{' } });
    expect((await selectEngine(['ping'], broken)).name).toBe('camunda7');
  });
});

describe('run with an unknown platform', () => {
  it('fails with the list of known engines', async () => {
    const result = await execute(run, ['ping', '--platform', 'camunda8'], fakeRuntime());
    expect(result.code).toBe(3);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: {
        code: 'CONFIG',
        message: 'Unknown platform "camunda8"',
        hint: 'Use one of: operaton, cibseven, camunda7',
      },
    });
  });
});
