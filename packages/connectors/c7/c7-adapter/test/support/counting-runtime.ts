import { createEnginePort } from "@miragon/pulse-c7-core"
import { C7Runtime, type WithIncidentPath } from "@miragon/pulse-c7-core/runtime"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { EngineHttp, HttpEngineTransport } from "../../src/engine-rest/index.js"
import { ErrorTranslation } from "../../src/errors/error-translation.js"

const PAGES_OF_ONE_THE_WORLD_FILLS = 1
const COUNT_OF_NO_VERSION = "a count of no version"

function pathPastTheFirstPageOf(target: URL): string | undefined {
  if (target.searchParams.get("withIncident") !== "true") return undefined
  if (target.pathname.endsWith("/process-instance/count")) {
    const version = target.searchParams.get("processDefinitionId")
    if (version === null) return undefined
    return version === "" ? COUNT_OF_NO_VERSION : "perVersion"
  }
  const after = Number(target.searchParams.get("firstResult") ?? "0")
  return target.pathname.endsWith("/process-instance") && after > 0 ? "listing" : undefined
}

export function runtimeCountingWithIncidentBy(
  url: string,
  path: WithIncidentPath,
  taken: string[],
): ProcessRuntime {
  const http = new EngineHttp({
    url,
    credentials: { kind: "none" },
    writes: false,
    send: (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input))
      const took = pathPastTheFirstPageOf(target)
      if (took !== undefined) taken.push(took)
      return fetch(input, init)
    },
  })
  return C7Runtime.over(createEnginePort(HttpEngineTransport.over(http)), {
    failureOf: (error) => ErrorTranslation.runtimeError(error),
    withIncidentCounting: { pageSize: PAGES_OF_ONE_THE_WORLD_FILLS, path },
  })
}
