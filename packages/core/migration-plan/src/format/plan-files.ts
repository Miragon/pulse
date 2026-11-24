import type { MigrationPlanDefinition } from "./plan-definition.js"

type PlanName = Pick<MigrationPlanDefinition, "bpmnProcessId" | "source" | "target">

export class MigrationPlanFiles {
  static readonly FOLDER = ".pulse/migrations"
  static readonly SUFFIX = ".migration.json"

  static nameOf(plan: PlanName): string {
    const source = String(plan.source.version)
    const target = String(plan.target.version)
    return `${plan.bpmnProcessId}-v${source}-to-v${target}${MigrationPlanFiles.SUFFIX}`
  }

  static pathOf(plan: PlanName): string {
    return `${MigrationPlanFiles.FOLDER}/${MigrationPlanFiles.nameOf(plan)}`
  }

  static isPlanPath(path: string): boolean {
    const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
    return (
      name.length > MigrationPlanFiles.SUFFIX.length && name.endsWith(MigrationPlanFiles.SUFFIX)
    )
  }
}
