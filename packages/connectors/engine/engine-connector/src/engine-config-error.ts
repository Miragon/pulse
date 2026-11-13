/**
 * A boot config error of a module setting names the variable to fix, never the schema's own path:
 * `ENGINE_INCIDENT_ISSUE_REPO: …`, every issue on one line. The engines themselves are profiles,
 * whose errors `engine-profiles.ts` words.
 */

interface ConfigIssue {
  path: readonly PropertyKey[]
  message: string
}

/** The variable behind each setting (dotted for the nested ones). */
const SETTINGS: Readonly<Record<string, string>> = {
  defaultEngine: "ENGINE_DEFAULT",
  allowDeployments: "ENGINE_ALLOW_DEPLOYMENTS",
  requestTimeoutMs: "ENGINE_REQUEST_TIMEOUT_MS",
  incidentIssueRepository: "ENGINE_INCIDENT_ISSUE_REPO",
  "healthThresholds.criticalIncidents": "ENGINE_HEALTH_CRITICAL_INCIDENTS",
  "healthThresholds.criticalClusterSize": "ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE",
}

/** One line: each issue behind the variable it came from, unless its message names it already. */
export function engineConfigErrorText(issues: readonly ConfigIssue[]): string {
  const lines = issues.map(({ path, message }) => {
    const place = SETTINGS[path.map(String).join(".")]
    return place === undefined || message.startsWith(place) ? message : `${place}: ${message}`
  })
  return [...new Set(lines)].join("; ")
}
