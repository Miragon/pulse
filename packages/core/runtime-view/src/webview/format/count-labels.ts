const exact = new Intl.NumberFormat("en")
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

export class CountLabels {
  static compact(count: number): string {
    return count < 1000 ? exact.format(count) : compact.format(count).toLowerCase()
  }

  static exact(count: number): string {
    return exact.format(count)
  }

  static plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${exact.format(count)} ${count === 1 ? singular : pluralForm}`
  }
}
