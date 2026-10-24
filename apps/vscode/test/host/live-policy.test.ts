import { describe, expect, test } from 'vitest';
import type { EngineTarget } from '../../src/host/connections/engine-target.js';
import { EngineLanes } from '../../src/host/connections/engine-lanes.js';
import { LivePolicy } from '../../src/host/connections/live-policy.js';

describe('the live updates policy', () => {
  test('is on for local and test engines and off for the others until the user turns them on', () => {
    expect(LivePolicy.settingFor('local', undefined)).toBe('on');
    expect(LivePolicy.settingFor('test', undefined)).toBe('on');
    expect(LivePolicy.settingFor('production', undefined)).toBe('off');
    expect(LivePolicy.settingFor('unclassified', undefined)).toBe('off');
  });

  test('follows the user settings and ignores values it does not know', () => {
    const user = { production: 'on', local: 'off', test: 'sometimes' };
    expect(LivePolicy.settingFor('production', user)).toBe('on');
    expect(LivePolicy.settingFor('local', user)).toBe('off');
    expect(LivePolicy.settingFor('test', user)).toBe('on');
    expect(LivePolicy.settingFor('test', 'on')).toBe('on');
  });

  test('turns one environment on and keeps the others the user chose', () => {
    expect(LivePolicy.turnedOn({ local: 'off' }, 'production')).toEqual({
      local: 'off',
      production: 'on',
    });
    expect(LivePolicy.turnedOn(undefined, 'unclassified')).toEqual({ unclassified: 'on' });
  });
});

describe('the engine lanes', () => {
  const target = (name: string, endpoint: string) =>
    ({ name, endpoint }) as unknown as EngineTarget;
  const NONE = { kind: 'none' } as const;

  test('share one lane per endpoint and login, and keep it across reloads', () => {
    const lanes = new EngineLanes();
    const [dev, alias, other] = lanes.assign([
      { target: target('dev', 'http://a'), credentials: NONE },
      { target: target('dev-again', 'http://a/'), credentials: NONE },
      { target: target('test', 'http://b'), credentials: NONE },
    ]);
    expect(dev?.lane).toBe(alias?.lane);
    expect(dev?.lane).not.toBe(other?.lane);

    const [reloaded] = lanes.assign([{ target: target('dev', 'http://a'), credentials: NONE }]);
    expect(reloaded?.lane).toBe(dev?.lane);
  });

  test('start a fresh lane for new credentials', () => {
    const lanes = new EngineLanes();
    const login = (password: string) => ({ kind: 'basic', username: 'demo', password }) as const;
    const [before] = lanes.assign([
      { target: target('dev', 'http://a'), credentials: login('old') },
    ]);
    const [after] = lanes.assign([
      { target: target('dev', 'http://a'), credentials: login('new') },
    ]);

    expect(after?.lane).not.toBe(before?.lane);
  });
});
