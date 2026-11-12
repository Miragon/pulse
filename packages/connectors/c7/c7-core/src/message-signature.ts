/**
 * The family's one incident mask: the status triage groups its incidents by it, and the MCP
 * cockpit builds its failure clusters and their route ids from it; `causeKeyOf` builds one cause
 * from it, so `engine_status`, `pulse status` and the cockpit count one cause alike.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const HEX_RUN = /\b[0-9a-f]{16,}\b/g
const SINGLE_QUOTED = /'[^']*'/g
const DOUBLE_QUOTED = /"[^"]*"/g
const NUMBER = /\b\d+\b/g

/** The longest signature; a stacktrace-sized message is cut. */
export const MESSAGE_SIGNATURE_LENGTH = 160

/**
 * An incident message without its volatile tokens, so instance noise never splits one cause into
 * many groups: lowercased, whitespace runs as one space, UUIDs and hex runs of 16+ characters as
 * `<id>`, quoted values as `'<v>'` / `"<v>"`, whole numbers as `<n>`, trimmed and cut at 160
 * characters. A missing or empty message has the empty signature. The values are route ids of
 * the cockpit's cluster links: a change breaks the links stored in earlier results.
 */
export function messageSignature(message: string | null | undefined): string {
  if (!message) return ""
  return message
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(UUID, "<id>")
    .replace(HEX_RUN, "<id>")
    .replace(SINGLE_QUOTED, "'<v>'")
    .replace(DOUBLE_QUOTED, '"<v>"')
    .replace(NUMBER, "<n>")
    .trim()
    .slice(0, MESSAGE_SIGNATURE_LENGTH)
}
