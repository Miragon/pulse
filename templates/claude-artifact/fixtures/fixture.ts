import type { ToolRecording } from "@miragon/pulse-widget-shell/widgets"

/**
 * A recording of one dashboard load (`pnpm record`), in widget-shell's recording format
 * (`ToolRecording`): when the calls ran, the zone the days were counted in and every call the reads
 * made, in one run (ids are per engine boot, so recordings are never joined), each with its answer
 * as the server sent it, kept small. It also names the process it is of and the engine the server
 * read. `playRecording` replays it in `pnpm dev`, `pnpm shot` and the tests.
 */
export type Fixture = ToolRecording & {
  readonly process: string
  readonly engine: string
}
