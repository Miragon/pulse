/** What every command action of the CLI gets: the runtime, the engine, its catalog and the run state. */

import type { Catalog } from '../catalog/types.js';
import type { OutputFormat } from '../config/types.js';
import type { EngineAdapter } from '../engine-port/engine-adapter.js';
import type { Runtime } from '../runtime.js';

/**
 * Mutable state of one `run()`: commands record the output format as soon as it is resolved, so
 * that errors raised later are rendered in the same format.
 */
export interface CliState {
  format?: OutputFormat;
  /** The arguments of the run (`operate` left out): ready commands in hints keep the options. */
  readonly argv?: readonly string[];
}

export interface CliContext {
  readonly runtime: Runtime;
  readonly engine: EngineAdapter;
  readonly catalog: Catalog;
  readonly state: CliState;
}
