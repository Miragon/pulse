import type { EngineLane } from './engine-lane.js';
import type { LiveSwitch } from './live-switch.js';
import type { Scheduler } from './scheduler.js';

export type Attention = 'watched' | 'hidden' | 'background' | 'idle';

export interface LiveContext {
  readonly switch: LiveSwitch;
  readonly scheduler: Scheduler;
  readonly lane: EngineLane;
  readonly random: () => number;
  readonly log: (line: string) => void;
}
