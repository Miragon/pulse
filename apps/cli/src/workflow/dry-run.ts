/**
 * `--dry-run` of the workflow commands: the plan of the writes and a preview of
 * every request that would be sent, secrets masked like every other preview, plus the notes
 * of the auth provider (e.g. that there is no OAuth login) for stderr.
 */

import type { EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { curlCommand, maskHeaders, maskUrl } from "../output/secrets.js"
import { compact } from "../util.js"

interface DryRunRequest {
  readonly summary?: string
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly curl: string
}

export interface DryRunView {
  readonly plan?: unknown
  readonly requests: readonly DryRunRequest[]
}

export interface DryRunOutput {
  readonly view: DryRunView
  /** The distinct notes of the auth previews, printed to stderr as `Note: <note>`. */
  readonly notes: readonly string[]
}

export async function dryRunOutput(
  result: { readonly plan?: unknown; readonly requests: readonly PlannedRequest[] },
  port: EnginePort,
  showSecrets: boolean,
): Promise<DryRunOutput> {
  const previews = await Promise.all(
    result.requests.map(async (planned) => ({ planned, ...(await port.preview(planned)) })),
  )
  const requests = previews.map(({ planned, request: preview }) => {
    const masked = {
      method: preview.method,
      url: maskUrl(preview.url, showSecrets),
      headers: maskHeaders(preview.headers, showSecrets),
      ...compact({ body: preview.body }),
    }
    return { ...compact({ summary: planned.summary }), ...masked, curl: curlCommand(masked) }
  })
  const notes = new Set(previews.flatMap(({ note }) => (note === undefined ? [] : [note])))
  return { view: { ...compact({ plan: result.plan }), requests }, notes: [...notes] }
}

/** Per request a `# <summary>` line (writes only) and the curl command line. */
export function dryRunText(view: DryRunView): string {
  const lines = view.requests.flatMap((request) => [
    ...(request.summary === undefined ? [] : [`# ${request.summary}`]),
    request.curl,
  ])
  return `${lines.join("\n")}\n`
}
