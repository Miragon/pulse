import { describe, expect, test } from 'vitest';
import { fakeEngineCli } from './fake-engine-cli.js';

function invoke(spawner: ReturnType<typeof fakeEngineCli>['spawner'], args: readonly string[]) {
  return spawner.spawn({
    command: 'node',
    args: ['/cli.js', ...args],
    environment: {},
    timeoutMs: 1,
  });
}

describe('the fake engine CLI', () => {
  test('answers with the most specific route, whatever the declaration order', async () => {
    const cli = fakeEngineCli([
      { command: ['incident', 'list'], stdout: 'generic' },
      { command: ['incident', 'list', '--process-definition-id', 'order:1'], stdout: 'specific' },
    ]);

    const exit = await invoke(cli.spawner, [
      'incident',
      'list',
      '--process-definition-id',
      'order:1',
    ]);

    expect(exit.stdout).toBe('specific');
  });

  test('reports the routes no command reached', async () => {
    const used = { command: ['version', 'get'], stdout: '{}' };
    const unused = { command: ['telemetry', 'get-data'], stdout: '{}' };
    const cli = fakeEngineCli([used, unused]);

    await invoke(cli.spawner, ['version', 'get']);

    expect(cli.unusedRoutes()).toEqual([unused]);
  });

  test('refuses commands without a route and ambiguous routes', async () => {
    const cli = fakeEngineCli([
      { command: ['inspect'], when: () => true, stdout: 'one' },
      { command: ['inspect'], when: () => true, stdout: 'two' },
    ]);

    await expect(invoke(cli.spawner, ['ping'])).rejects.toThrow('no fake route');
    await expect(invoke(cli.spawner, ['inspect', 'x'])).rejects.toThrow('ambiguous');
  });
});
