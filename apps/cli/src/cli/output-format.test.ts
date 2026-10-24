import { describe, expect, it } from 'vitest';
import { CONFIG_PATH, fakeRuntime } from '../../test/support/fake-runtime.js';
import {
  envFormat,
  maxWidthOf,
  profileFormat,
  terminalColumns,
  terminalFormat,
} from './output-format.js';

describe('terminal width and format', () => {
  it('chooses the default format by terminal', () => {
    expect(terminalFormat(fakeRuntime())).toBe('json');
    expect(terminalFormat(fakeRuntime({ stdoutTTY: true }))).toBe('table');
  });

  it('uses the terminal width, else 120; 0 columns count as unknown', () => {
    expect(maxWidthOf(fakeRuntime())).toBe(120);
    expect(maxWidthOf(fakeRuntime({ stdoutTTY: true, columns: 90 }))).toBe(90);
    expect(maxWidthOf(fakeRuntime({ stdoutTTY: true, columns: 0 }))).toBe(120);
    expect(terminalColumns(fakeRuntime({ stdoutTTY: true, columns: 0 }))).toBeUndefined();
    expect(terminalColumns(fakeRuntime({ stdoutTTY: true }))).toBeUndefined();
    expect(terminalColumns(fakeRuntime({ columns: 90 }))).toBeUndefined();
    // a pipe that reports a width (some wrappers do) still is no terminal
    const piped = fakeRuntime();
    Object.assign(piped.stdout, { columns: 90 });
    expect(terminalColumns(piped)).toBeUndefined();
    expect(maxWidthOf(piped)).toBe(120);
  });
});

describe('envFormat', () => {
  it('reads OPERATE_OUTPUT, blank is unset; strict mode rejects unknown values', () => {
    const env = (value: string | undefined) => fakeRuntime({ env: { OPERATE_OUTPUT: value } });
    expect(envFormat(env(' table '), true)).toBe('table');
    expect(envFormat(env(' '), true)).toBeUndefined();
    expect(envFormat(env(undefined), true)).toBeUndefined();
    expect(envFormat(env('yaml'), false)).toBeUndefined();
    expect(() => envFormat(env('yaml'), true)).toThrow('Unknown output format "yaml"');
  });
});

describe('profileFormat', () => {
  const file = JSON.stringify({ defaultProfile: 'a', profiles: { a: { output: 'table' }, b: {} } });

  it('reads the output of the selected profile', async () => {
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: file } });
    expect(await profileFormat(runtime, {})).toBe('table');
    expect(await profileFormat(runtime, { profile: 'b' })).toBeUndefined();
    const env = fakeRuntime({ files: { [CONFIG_PATH]: file }, env: { OPERATE_PROFILE: 'b' } });
    expect(await profileFormat(env, {})).toBeUndefined();
  });

  it('never fails: missing files, broken files and unknown profiles give undefined', async () => {
    expect(await profileFormat(fakeRuntime(), {})).toBeUndefined();
    expect(await profileFormat(fakeRuntime(), { config: '/missing.json' })).toBeUndefined();
    const broken = fakeRuntime({ files: { [CONFIG_PATH]: '{"profiles":' } });
    expect(await profileFormat(broken, {})).toBeUndefined();
    const runtime = fakeRuntime({ files: { [CONFIG_PATH]: file } });
    expect(await profileFormat(runtime, { profile: 'nope' })).toBeUndefined();
  });
});
