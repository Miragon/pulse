import { formatCompactCount, formatCount } from "@miragon/pulse-ui/format"
import { LabelLocale } from "./label-locale.js"

export class CountLabels {
  static {
    LabelLocale.apply()
  }

  static compact(count: number, atLeast = false): string {
    return formatCompactCount(atLeast ? { atLeast: count } : count)
  }

  static exact(count: number, atLeast = false): string {
    return formatCount(atLeast ? { atLeast: count } : count)
  }

  static plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`
  }
}
