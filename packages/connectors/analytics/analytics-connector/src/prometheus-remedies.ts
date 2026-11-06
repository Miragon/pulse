import {
  PrometheusRequestError,
  type PrometheusClient,
  type PrometheusFailureKind,
} from "@miragon/pulse-analytics-client"

/**
 * The client knows the wire; the variables are this module's (`knownEnvVars`) and the module list
 * the boot's, so the way out is worded here. Names only, never a value: PROMETHEUS_URL can carry
 * credentials in its userinfo, and these texts reach the model.
 */
const CHECK_TARGET =
  "Check PROMETHEUS_URL, which decides the target; a server without a Prometheus leaves analytics out of MCP_ACTIVE_MODULES."

const REMEDIES: Readonly<Record<PrometheusFailureKind, string | undefined>> = {
  unreachable: CHECK_TARGET,
  "foreign-answer": CHECK_TARGET,
  timeout: "PROMETHEUS_TIMEOUT_MS sets this deadline, PROMETHEUS_URL the target.",
  unauthorized:
    "Check the credentials: PROMETHEUS_BEARER_TOKEN, or PROMETHEUS_USERNAME and PROMETHEUS_PASSWORD.",
  // Prometheus's own answer is about the query; a caller's cancel leaves nothing to fix.
  query: undefined,
  cancelled: undefined,
}

const asSentence = (text: string): string => (/[.?!…]$/.test(text) ? text : `${text}.`)

/** Every failed query names the setting behind it and the way out. */
export function withRemedies(client: PrometheusClient): PrometheusClient {
  return {
    async instant(query, options) {
      try {
        return await client.instant(query, options)
      } catch (error) {
        if (!(error instanceof PrometheusRequestError)) throw error
        const remedy = REMEDIES[error.kind]
        if (remedy === undefined) throw error
        throw new Error(`${asSentence(error.message)} ${remedy}`, { cause: error })
      }
    },
  }
}
