/**
 * What the server's surfaces of an engine's status give, each read through the module's own tool
 * as a client calls it, with the default thresholds or at one `ENGINE_HEALTH_CRITICAL_INCIDENTS`:
 * `engine_status`, the web app's verdict feed (`engine_screen_verdict_data`) and the chat
 * overview's health feed (`engine_health_data`). The
 * recording script of c7-core's recorded status engine writes what they give
 * (status-world.record.test.ts), the numbers tests hold each to the recording over its answers
 * (engine-status.numbers.test.ts, verdict-data.numbers.test.ts, health-data.numbers.test.ts) and
 * the engine suite holds a world seeded on CIB seven or Operaton to its figures
 * (status-world.engine.test.ts).
 */

import type { z } from "zod"
import type { C7EdgeVerdict } from "@miragon/pulse-c7-core/testing"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { engineModule } from "../../module.js"
import { ENGINE_HEALTH_DATA, ENGINE_SCREEN_VERDICT_DATA } from "../../tool-names.js"
import { feedPayload } from "../../tools/test-support/feed-payload.js"

/** Each surface by the name the recording keeps it under, and the tool that answers it. */
const SURFACE_TOOLS = {
  engineStatus: "engine_status",
  verdict: ENGINE_SCREEN_VERDICT_DATA,
  health: ENGINE_HEALTH_DATA,
} as const

export type StatusSurface = keyof typeof SURFACE_TOOLS

/** What the server's surfaces give of one engine, each the JSON its tool answers with. */
export type StatusSurfaces = Readonly<Record<StatusSurface, unknown>>

/** An engine the server reads: its name and its REST root. */
interface StatusProfile {
  readonly engine: string
  readonly url: string
}

/**
 * The server over `profiles`, Operaton or CIB seven engines by `flavor`, critical from
 * `criticalIncidents` open root incidents where given (else by the defaults): `read` gives what one
 * surface gives of one engine, `readAll` what all three give of it, read at once.
 */
export function statusServer(
  profiles: readonly StatusProfile[],
  flavor: string,
  criticalIncidents?: number,
) {
  const config = engineModule.configFromEnv({
    ENGINES_JSON: JSON.stringify({
      profiles: Object.fromEntries(profiles.map(({ engine, url }) => [engine, { url, flavor }])),
    }),
    ...(criticalIncidents === undefined
      ? {}
      : { ENGINE_HEALTH_CRITICAL_INCIDENTS: String(criticalIncidents) }),
  })
  const recording = recordingModuleServer()
  engineModule.createPlugin(config).register(recording.server)
  const read = async (surface: StatusSurface, engine: string): Promise<unknown> => {
    const tool = recording.tool(SURFACE_TOOLS[surface])
    const result = await tool.call((tool.config.inputSchema as z.ZodObject).parse({ engine }))
    if ((result as { isError?: boolean }).isError === true) {
      throw new Error(`${SURFACE_TOOLS[surface]} on ${engine}: ${JSON.stringify(result)}`)
    }
    return feedPayload(result)
  }
  const readAll = async (engine: string): Promise<StatusSurfaces> => {
    const [engineStatus, verdict, health] = await Promise.all([
      read("engineStatus", engine),
      read("verdict", engine),
      read("health", engine),
    ])
    return { engineStatus, verdict, health }
  }
  return { read, readAll }
}

/** A surface's `status`, the verdict it states. */
export const statusOf = (given: unknown): string => (given as { readonly status: string }).status

/**
 * What the three surfaces judge of `engine` at `criticalIncidents` (a server of its own, so no
 * answer kept on another's floor stands in): the verdict feed whole, the others' `status`.
 */
export async function judgedAt(
  profiles: readonly StatusProfile[],
  flavor: string,
  engine: string,
  criticalIncidents: number,
): Promise<C7EdgeVerdict> {
  const given = await statusServer(profiles, flavor, criticalIncidents).readAll(engine)
  return {
    criticalIncidents,
    verdict: given.verdict,
    engineStatus: statusOf(given.engineStatus),
    health: statusOf(given.health),
  }
}
