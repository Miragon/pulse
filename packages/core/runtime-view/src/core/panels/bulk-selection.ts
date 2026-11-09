import type { InstanceId } from "../../contract/index.js"
import type { BulkOffer, SelectionView } from "../protocol/index.js"

export const BULK_CAP = 1000

export interface SelectionOffers {
  readonly eligible: string
  readonly matching: number
  readonly offers: readonly BulkOffer[]
  readonly migration?: string
  readonly blockedBy?: string
}

export class BulkSelection {
  private ids = new Set<InstanceId>()
  private everyMatching = false
  private refused: number | undefined

  toggle(instanceIds: readonly InstanceId[], selected: boolean): void {
    this.everyMatching = false
    this.refused = undefined
    const next = new Set(this.ids)
    for (const id of instanceIds) {
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
    }
    if (next.size > BULK_CAP) {
      this.refused = next.size
      return
    }
    this.ids = next
  }

  selectAll(instanceIds: readonly InstanceId[]): void {
    this.ids = new Set(instanceIds.slice(0, BULK_CAP))
    this.everyMatching = true
    this.refused = undefined
  }

  refuse(matching: number): void {
    this.refused = matching
  }

  clear(): void {
    this.ids = new Set()
    this.everyMatching = false
    this.refused = undefined
  }

  selected(): readonly InstanceId[] {
    return [...this.ids]
  }

  has(instanceId: InstanceId): boolean {
    return this.ids.has(instanceId)
  }

  view(offers: SelectionOffers): SelectionView | undefined {
    if (this.ids.size === 0 && this.refused === undefined) {
      return undefined
    }
    const overCap = this.refused ?? (offers.matching > BULK_CAP ? offers.matching : undefined)
    const offersMore =
      !this.everyMatching && offers.matching > this.ids.size && overCap === undefined
    return {
      count: this.ids.size,
      eligible: offers.eligible,
      allMatching: this.everyMatching,
      cap: BULK_CAP,
      offers: offers.offers,
      ...(offersMore ? { matching: offers.matching } : {}),
      ...(overCap === undefined ? {} : { overCap }),
      ...this.optionalOffers(offers),
    }
  }

  private optionalOffers(offers: SelectionOffers): Pick<SelectionView, "migration" | "blockedBy"> {
    return {
      ...(offers.migration === undefined ? {} : { migration: offers.migration }),
      ...(offers.blockedBy === undefined ? {} : { blockedBy: offers.blockedBy }),
    }
  }
}
