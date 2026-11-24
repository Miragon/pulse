import type { MigrationPlanParse } from "./plan-definition.js"

export class MigrationPlanParser {
  static parse(text: string): MigrationPlanParse {
    throw new Error(`MigrationPlanParser.parse has no body for ${String(text.length)} characters`)
  }
}
