import { Labels } from "./labels.js"
import type { MigrationElements } from "./migration-elements.js"

export class MigrationFacts {
  static readonly UNDONE = "Migrating can't be undone."
  static readonly CALLED = "Called instances stay on their version."
  static readonly TRIGGERS = "New or unmapped timers and subscriptions start now."

  static modelFacts(elements: MigrationElements): string[] {
    return [
      ...(elements.hasCallActivity() ? [MigrationFacts.CALLED] : []),
      ...(elements.hasCatchingEvents() ? [MigrationFacts.TRIGGERS] : []),
    ]
  }

  static ownWay(version: number, count: number): string {
    return count === 1
      ? `If it fails, it stays on v${version}.`
      : `Each migrates on its own; failed ones stay on v${version}.`
  }

  static incidents(count: number, target: number): string[] {
    if (count === 0) {
      return []
    }
    return count === 1
      ? [`1 has an incident and keeps it; retry it on v${target}.`]
      : [`${count} have an incident and keep it; retry them on v${target}.`]
  }

  static versionNotes(source: number, target: number, latest: number | undefined): string[] {
    if (target < source) {
      return [`v${target} is older than v${source}.`]
    }
    return latest !== undefined && target < latest
      ? [`v${target} is not the latest version (v${latest}).`]
      : []
  }

  static findings(problems: number, unmapped: number): string {
    if (problems > 0) {
      return Labels.plural(problems, "problem")
    }
    return unmapped === 0 ? "no problems" : `${unmapped} without a mapping`
  }

  static unmapped(labels: readonly string[], target: number): string {
    const has = labels.length === 1 ? "has" : "have"
    return `Instances wait at ${labels.join(", ")}, which ${has} no mapping in v${target}.`
  }
}
