import type { Environment } from '../protocol/index.js';

export type LiveView = 'instance' | 'definition' | 'engine' | 'tree';

type Band = 'local' | 'test' | 'production';

const INTERVAL_SECONDS: Readonly<Record<Band, Readonly<Record<LiveView, number>>>> = {
  local: { instance: 5, definition: 10, engine: 15, tree: 30 },
  test: { instance: 15, definition: 30, engine: 30, tree: 60 },
  production: { instance: 30, definition: 60, engine: 60, tree: 120 },
};

const BACKOFF_CAP_SECONDS: Readonly<Record<Band, number>> = {
  local: 30,
  test: 300,
  production: 900,
};

const SECOND = 1000;
const SELF_THROTTLE = 4;
const JITTER = 0.2;
const CATCH_UP_SPREAD_MS = 2000;
const HISTORY_EVERY_TICKS = 4;

export class RefreshCadence {
  static intervalMs(view: LiveView, environment: Environment): number {
    return INTERVAL_SECONDS[RefreshCadence.bandOf(environment)][view] * SECOND;
  }

  static throttledMs(intervalMs: number, lastLoadMs: number): number {
    return Math.max(intervalMs, lastLoadMs * SELF_THROTTLE);
  }

  static nextMs(intervalMs: number, lastLoadMs: number, random: () => number): number {
    const base = RefreshCadence.throttledMs(intervalMs, lastLoadMs);
    return Math.round(base * (1 - JITTER + 2 * JITTER * random()));
  }

  static backoffMs(
    intervalMs: number,
    failures: number,
    environment: Environment,
    random: () => number,
  ): number {
    const cap = BACKOFF_CAP_SECONDS[RefreshCadence.bandOf(environment)] * SECOND;
    const ceiling = Math.min(cap, intervalMs * 2 ** failures);
    return Math.round(Math.max(Math.min(intervalMs, cap), ceiling * (0.5 + random() / 2)));
  }

  static catchUpMs(random: () => number): number {
    return Math.round(CATCH_UP_SPREAD_MS * random());
  }

  static readsHistoryOnTicks(environment: Environment): boolean {
    return RefreshCadence.bandOf(environment) !== 'production';
  }

  static readsHistory(tick: number, environment: Environment): boolean {
    return RefreshCadence.readsHistoryOnTicks(environment) && tick % HISTORY_EVERY_TICKS === 0;
  }

  static readsVersions(tick: number, environment: Environment): boolean {
    return RefreshCadence.bandOf(environment) === 'local' || tick % HISTORY_EVERY_TICKS === 0;
  }

  static seconds(milliseconds: number): number {
    return Math.max(1, Math.round(milliseconds / SECOND));
  }

  private static bandOf(environment: Environment): Band {
    return environment === 'unclassified' ? 'production' : environment;
  }
}
