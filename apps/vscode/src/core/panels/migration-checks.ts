import type { MigrationCheck, MigrationPlan } from "../../contract/index.js"
import type { PanelContext } from "./panel-context.js"
import { Problems } from "./problems.js"

const SETTLE_MS = 300

export type CheckOutcome =
  | { readonly kind: "checked"; readonly check: MigrationCheck }
  | { readonly kind: "failed"; readonly message: string }

export class MigrationChecks {
  private generation = 0
  private draining = false
  private pending: MigrationPlan | undefined

  constructor(
    private readonly context: PanelContext,
    private readonly checked: (plan: MigrationPlan, outcome: CheckOutcome) => void,
  ) {}

  schedule(plan: MigrationPlan): void {
    this.generation += 1
    this.pending = plan
    if (!this.draining) {
      void this.drain()
    }
  }

  cancel(): void {
    this.generation += 1
    this.pending = undefined
  }

  isBusy(): boolean {
    return this.draining
  }

  private async drain(): Promise<void> {
    this.draining = true
    for (let plan = this.pending; plan !== undefined; plan = this.pending) {
      const generation = this.generation
      await this.context.wait(SETTLE_MS)
      if (generation === this.generation) {
        this.pending = undefined
        const outcome = await this.outcomeOf(plan)
        if (generation === this.generation) {
          this.checked(plan, outcome)
        }
      }
    }
    this.draining = false
  }

  private async outcomeOf(plan: MigrationPlan): Promise<CheckOutcome> {
    try {
      return { kind: "checked", check: await this.context.runtime.checkMigration(plan) }
    } catch (error) {
      const problem = Problems.of(error, this.context.engine)
      return { kind: "failed", message: `${problem.title} ${problem.detail}` }
    }
  }
}
