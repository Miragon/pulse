import type { VersionPick } from "./plan-definition.js"

export class MigrationPlanVersions {
  static pick<T extends { readonly version: number }>(
    candidates: readonly T[],
    version: number,
  ): VersionPick<T> {
    return MigrationPlanVersions.only(
      candidates.filter((candidate) => candidate.version === version),
    )
  }

  static only<T>(candidates: readonly T[]): VersionPick<T> {
    const [candidate] = candidates
    if (candidate === undefined) {
      return { kind: "missing" }
    }
    return candidates.length === 1
      ? { kind: "found", candidate }
      : { kind: "ambiguous", count: candidates.length }
  }
}
