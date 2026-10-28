/**
 * The `--verbose` trace of the CLI as the request record of the bearer tests (no gateway log
 * needed): `> METHOD url` lines are requests, `< status
 * text (...)` lines their answers.
 */

const REQUEST_LINE = /^> ([A-Z]+) (\S+)$/
const RESPONSE_LINE = /^< (\d{3})\b/

function abbreviate(url: string, names: Readonly<Record<string, string>>): string {
  for (const [name, prefix] of Object.entries(names)) {
    if (url.startsWith(prefix)) return `<${name}>${url.slice(prefix.length)}`
  }
  return url
}

/**
 * The requests and answers of a run in order, e.g. `['> GET <engine>/version', '< 401', '> POST
 * <token>', '< 200']`: URLs starting with one of `names`' values are shortened to `<name>`.
 */
export function traceOf(stderr: string, names: Readonly<Record<string, string>>): string[] {
  return stderr.split("\n").flatMap((line) => {
    const request = REQUEST_LINE.exec(line)
    if (request !== null) return [`> ${request[1] ?? ""} ${abbreviate(request[2] ?? "", names)}`]
    const response = RESPONSE_LINE.exec(line)
    return response === null ? [] : [`< ${response[1] ?? ""}`]
  })
}

/** Any request line: the run sent something. */
export const SENT_REQUEST = /^> [A-Z]+ \S+$/m
/** The masked Bearer header in the trace. */
export const MASKED_BEARER = /^> authorization: Bearer \*\*\*$/im
