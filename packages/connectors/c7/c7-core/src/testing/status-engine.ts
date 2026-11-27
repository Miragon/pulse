/**
 * The status world (`seedC7StatusWorld`) recorded on two engines of the family, one at history
 * level FULL and one at NONE: each engine's answers to the reads of the status triage
 * (`engine_status` and the CLI's `pulse status`, both c7-core's `readStatus`, its round one and the
 * root causes of round two), of the chat overview's health and of the web app's verdict feed, at
 * one instant (`asOf`), and what each of those surfaces gives from them. The CLI over its own
 * wire and the MCP server's tool and feeds over the generated SDK each serve the answers on the
 * transport's recorded engine (`startRecordedEngine` of @miragon/pulse-http/testing/loopback) at
 * `asOf` and must give exactly the expected JSON, so the incidents outside any process, the copies
 * at a call activity and a multi-instance body's incident count the same on every surface without
 * an engine. A request a surface changes misses its answer and is named. The recording script
 * writes it (`pnpm record:status-world`, the package's README says how).
 */

import type { C7RecordedAnswer } from "./board-engine.js"
import recording from "./status-engine.json" with { type: "json" }

/**
 * What the MCP server's three surfaces judge of one engine at a threshold on the world's edge
 * (`ENGINE_HEALTH_CRITICAL_INCIDENTS`, the CLI having none): its open root incidents, where each
 * must say `critical`, or one more, where each must say `warning`; so a surface that counts a root
 * incident once too often or not at all turns its verdict at one of them.
 */
export interface C7EdgeVerdict {
  /** The threshold the server reads at: the root incidents `engine_status` counts, or one more. */
  readonly criticalIncidents: number
  /** The web app's verdict feed at it: the verdict and its outside count. */
  readonly verdict: unknown
  /** The `status` of `engine_status` at it. */
  readonly engineStatus: string
  /** The `status` of the chat overview's health at it. */
  readonly health: string
}

/** What each surface gives from one engine's answers, each in the JSON it answers with. */
export interface C7ExpectedStatus {
  /**
   * What `pulse status` prints (`-o json`, the CLI's default), its engine's address
   * `http://127.0.0.1:<port>/engine-rest`, the recorded engine's port left out.
   */
  readonly cliStatus: unknown
  /** The result of the MCP tool `engine_status`, without arguments. */
  readonly engineStatus: unknown
  /** The web app's verdict feed, `engine_screen_verdict_data`: the verdict and its outside count. */
  readonly verdict: unknown
  /** The chat overview's health feed, `engine_health_data`: the verdict, its summary, its causes. */
  readonly health: unknown
  /** What the server's surfaces judge at the world's root incidents, then at one more. */
  readonly atEdges: readonly C7EdgeVerdict[]
}

/** One engine of the recording: its name, its history level, its answers and what they give. */
export interface C7RecordedStatusEngine {
  /** The name a surface gives the engine it configures over the answers. */
  readonly engine: string
  /** The engine's history level: `full`, or `none`, whose history holds no instance. */
  readonly historyLevel: string
  /** The engine's answers under its REST root, `/engine-rest`. */
  readonly answers: readonly C7RecordedAnswer[]
  readonly expected: C7ExpectedStatus
}

/** The recorded status engines: where the answers come from, their instant and each engine. */
export interface C7StatusEngine {
  /** Where the answers come from. */
  readonly about: string
  /** The instant every surface reads at, as ISO text: the clock of the status and the health. */
  readonly asOf: string
  /** The engine at history level FULL, then the one at NONE. */
  readonly engines: readonly C7RecordedStatusEngine[]
}

export const C7_STATUS_ENGINE: C7StatusEngine = recording
