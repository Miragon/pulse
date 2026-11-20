import type { EngineScreenData } from "@miragon/pulse-screens"

/**
 * The engine screen's feed (the engine module's `SCREEN_FEEDS`): an app-only read of the engine
 * contract in every dialect, which the page's forward admits (`test/page-reads.test.ts`).
 */
export const ENGINE_SCREEN_FEED = "engine_screen_processes_data"

/** The engine screen's cache key, per engine: one read the screen and its Refresh share. */
export const engineScreenKey = (engine: string): readonly unknown[] => ["web:engine-screen", engine]

/** An engine's own web app: its address and its vendor's name, which the link names. */
interface EngineWebApp {
  readonly url: string
  readonly vendor: string
}

/**
 * What the feed answers: the engine screen in the JSON form of `@miragon/pulse-screens` (the
 * numbers the editors' engine tab shows), and beside it the engine's own web app, null without one.
 */
export interface EngineScreenFeed extends EngineScreenData {
  readonly webApp: EngineWebApp | null
}
