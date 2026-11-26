/**
 * The types of scripts/coverage-floors.mjs, the check that each package's coverage floors follow
 * their measurement and measure something, for vitest.shared.ts, which hands its reporter every
 * package's run.
 */
import type { Reporter } from "vitest/node"

/** How many points a floor may trail its measurement. */
export declare const FLOOR_MARGIN: 3

export type Metric = "lines" | "functions" | "statements" | "branches"

/** The four metrics, in the order vitest reports them. */
export declare const METRICS: readonly Metric[]

/** What the check reads of istanbul's coverage map, the one vitest checks its thresholds on. */
export interface CoverageMapLike {
  files(): string[]
  fileCoverageFor(file: string): {
    toSummary(): {
      readonly data: Readonly<Record<Metric, { readonly total: number; readonly covered: number }>>
    }
  }
}

/** A group vitest checks floors over: `global` or a glob key, quoted. */
export interface FloorGroup {
  readonly name: string
  readonly files: readonly string[]
  readonly summaries: readonly Readonly<
    Record<Metric, { readonly total: number; readonly covered: number }>
  >[]
  readonly checks: readonly {
    readonly label: string
    readonly floors: Readonly<Partial<Record<Metric, number>>>
    readonly perFile: boolean
  }[]
}

export declare function floorGroups(
  coverageMap: CoverageMapLike,
  thresholds: object,
  root: string,
): FloorGroup[]

/** Every floor of `thresholds` that lags its measurement or holds over an empty scope. */
export declare function floorFindings(
  coverageMap: CoverageMapLike,
  thresholds: object | undefined,
  root: string,
  margin?: number,
): string[]

/** The reporter vitest.shared.ts hands every package's run. */
export declare function coverageFloors(options?: { readonly margin?: number }): Reporter
