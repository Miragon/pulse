import type { ProcessCommands, ProcessRuntime } from '../../../../src/contract/index.js';
import { onTestFinished } from 'vitest';
import type { EngineCliExit, EngineCliInvocation, EngineCliSpawner } from '../../../../src/adapters/c7/index.js';
import { C7Adapter } from '../../../../src/adapters/c7/index.js';

export interface FakeRoute {
  readonly command: readonly string[];
  readonly when?: (args: readonly string[], input: string) => boolean;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

export interface FakeEngineCli {
  readonly spawner: EngineCliSpawner;
  readonly invocations: EngineCliInvocation[];
  readonly commands: () => string[][];
  readonly unusedRoutes: () => FakeRoute[];
}

export const FAKE_CLI_PATH = '/opt/pulse/engine-cli.js';
export const FAKE_CONFIG_PATH = '/tmp/pulse/engine-cli-config.json';
export const FAKE_URL = 'http://engine.test/engine-rest';

function matches(route: FakeRoute, args: readonly string[], input: string): boolean {
  const prefixMatches = route.command.every((part, index) => args[index] === part);
  return prefixMatches && (route.when?.(args, input) ?? true);
}

function specificityOf(route: FakeRoute): number {
  return route.command.length * 2 + (route.when === undefined ? 0 : 1);
}

function mostSpecific(
  routes: readonly FakeRoute[],
  args: readonly string[],
  input: string,
): FakeRoute {
  const candidates = routes
    .filter((route) => matches(route, args, input))
    .sort((left, right) => specificityOf(right) - specificityOf(left));
  const [best, runnerUp] = candidates;
  if (best === undefined) {
    throw new Error(`no fake route for: ${args.join(' ')}`);
  }
  if (runnerUp !== undefined && specificityOf(runnerUp) === specificityOf(best)) {
    throw new Error(`ambiguous fake routes for: ${args.join(' ')}`);
  }
  return best;
}

function exitOf(route: FakeRoute): EngineCliExit {
  return {
    exitCode: route.exitCode ?? 0,
    timedOut: false,
    stdout: route.stdout ?? '',
    stderr: route.stderr ?? '',
  };
}

export function fakeEngineCli(routes: readonly FakeRoute[]): FakeEngineCli {
  const invocations: EngineCliInvocation[] = [];
  const hit = new Set<FakeRoute>();
  const commandArgs = (invocation: EngineCliInvocation): string[] => invocation.args.slice(1);
  const spawner: EngineCliSpawner = {
    spawn: (invocation) => {
      invocations.push(invocation);
      try {
        const route = mostSpecific(routes, commandArgs(invocation), invocation.input ?? '');
        hit.add(route);
        return Promise.resolve(exitOf(route));
      } catch (error: unknown) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
  return {
    spawner,
    invocations,
    commands: () => invocations.map(commandArgs),
    unusedRoutes: () => routes.filter((route) => !hit.has(route)),
  };
}

function failOnUnusedRoutes(cli: FakeEngineCli): void {
  onTestFinished(() => {
    const unused = cli.unusedRoutes().map((route) => route.command.join(' '));
    if (unused.length > 0) {
      throw new Error(`fake engine CLI routes never hit: ${unused.join(' | ')}`);
    }
  });
}

const FAKE_CONNECTION = { endpoint: FAKE_URL, credentials: { kind: 'none' } } as const;

function adapterOver(cli: FakeEngineCli): C7Adapter {
  return new C7Adapter({ cliPath: FAKE_CLI_PATH, configPath: FAKE_CONFIG_PATH }, cli.spawner);
}

export function fakeRuntime(routes: readonly FakeRoute[]): {
  runtime: ProcessRuntime;
  cli: FakeEngineCli;
} {
  const cli = fakeEngineCli(routes);
  failOnUnusedRoutes(cli);
  return { runtime: adapterOver(cli).runtime(FAKE_CONNECTION), cli };
}

export function fakeCommands(routes: readonly FakeRoute[]): {
  commands: ProcessCommands;
  cli: FakeEngineCli;
} {
  const cli = fakeEngineCli(routes);
  failOnUnusedRoutes(cli);
  return { commands: adapterOver(cli).commands(FAKE_CONNECTION), cli };
}
