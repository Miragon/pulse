/** Statistics rows and a fixed clock for the status tests (src/workflow/status*.test.ts). */

export const NOW = Date.parse("2026-01-01T12:00:00.000Z")

export function statistics(
  key: string,
  version: number,
  [instances, failedJobs, incidents]: readonly [number, number, number],
) {
  return {
    id: `${key}:${version}:x`,
    instances,
    failedJobs,
    incidents: incidents === 0 ? [] : [{ incidentType: "failedJob", incidentCount: incidents }],
    definition: { id: `${key}:${version}:x`, key, version, name: `${key} v${version}` },
  }
}
