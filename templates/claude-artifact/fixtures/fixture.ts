import type { ToolRecording } from "@miragon/pulse-widget-shell/widgets"

/**
 * A recording of one dashboard load (`pnpm record`), in widget-shell's recording format
 * (`ToolRecording`): when the calls ran, the zone the days were counted in and every call the reads
 * made, in one run (ids are per engine boot, so recordings are never joined), each with its answer
 * kept as `src/data/recorded-reads.ts` says. It also names the process it is of, the engine the
 * server read and how its free text was kept. `playRecording` replays it in `pnpm dev`, `pnpm shot`
 * and the tests.
 */
export type Fixture = ToolRecording & {
  readonly process: string
  readonly engine: string
  /**
   * True where `pnpm record -- --keep-text` kept the free text as it came (an incident's message,
   * the diagram's documentation); false or absent where it was replaced, which
   * `test/fixtures.test.ts` holds by recording the fixture again.
   */
  readonly keepText?: boolean
}
