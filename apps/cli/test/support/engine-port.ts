/** An EnginePort of the workflow commands on a fake fetch, for unit tests of src/workflow. */

import { noAuth } from '../../src/auth/none.js';
import type { AuthProvider } from '../../src/auth/types.js';
import type { EnginePort } from '../../src/engine-port/engine-port.js';
import { camunda7 } from '../../src/engines/camunda7/adapter.js';
import type { WaitDeps } from '../../src/workflow/wait.js';
import { BASE_URL } from './fake-fetch.js';

export interface PortOptions {
  readonly engine?: string;
  readonly auth?: AuthProvider;
}

export function portOf(fetch: typeof globalThis.fetch, options: PortOptions = {}): EnginePort {
  const target = {
    baseUrl: BASE_URL,
    headers: {},
    ...(options.engine === undefined ? {} : { engine: options.engine }),
  };
  return camunda7.port(target, {
    fetch,
    auth: options.auth ?? noAuth(),
    timeoutMs: 5000,
    now: () => 0,
  });
}

/** A fake clock: `sleep` advances it at once and records the sleeps. */
export function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: (ms: number) => {
      sleeps.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
}

/** Wait deps on a fake fetch and a fake clock; `onSleep` lets time pass for the fake engine. */
export function depsOf(
  fetch: typeof globalThis.fetch,
  onSleep?: () => void,
): WaitDeps & { readonly sleeps: number[] } {
  const clock = fakeClock();
  return {
    port: portOf(fetch),
    now: clock.now,
    sleeps: clock.sleeps,
    sleep: async (ms) => {
      await clock.sleep(ms);
      onSleep?.();
    },
  };
}
