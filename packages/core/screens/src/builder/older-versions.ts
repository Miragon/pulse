import type { VersionSummary } from "@miragon/pulse-engine-core"
import type { OlderVersionsModel } from "./process-screen-model.js"

export class OlderVersions {
  static notice(
    versions: readonly VersionSummary[],
    selected: VersionSummary | undefined,
  ): OlderVersionsModel | undefined {
    const [newest, ...older] = versions
    const running = older.filter((version) => version.running > 0)
    const [show] = running
    if (newest !== selected || show === undefined) {
      return undefined
    }
    return {
      code: "olderVersionsRun",
      running: OlderVersions.sum(running, (version) => version.running),
      withIncident: OlderVersions.sum(running, (version) => version.withIncident),
      show: show.definition,
    }
  }

  private static sum(
    versions: readonly VersionSummary[],
    count: (version: VersionSummary) => number,
  ): number {
    return versions.reduce((total, version) => total + count(version), 0)
  }
}
