import type { MigrationPlanParse } from "../format/plan-definition.js"
import fixtures from "./migration-plan-fixtures.json" with { type: "json" }

export interface MigrationPlanFixture {
  readonly name: string
  readonly about: string
  readonly text: string
  readonly schema: boolean
  readonly verdict: MigrationPlanParse
}

interface FixtureEntry {
  readonly name: string
  readonly about: string
  readonly text?: string
  readonly file?: unknown
  readonly schema: boolean
  readonly verdict: MigrationPlanParse
}

class FixtureTexts {
  static of({ text, file, ...fixture }: FixtureEntry): MigrationPlanFixture {
    return { ...fixture, text: text ?? `${JSON.stringify(file, undefined, 2)}\n` }
  }
}

export const MIGRATION_PLAN_FIXTURES: readonly MigrationPlanFixture[] = (
  fixtures as readonly FixtureEntry[]
).map((entry) => FixtureTexts.of(entry))
