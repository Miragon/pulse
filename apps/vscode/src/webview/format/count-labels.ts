const exact = new Intl.NumberFormat("en")
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

export class CountLabels {
  static compact(count: number, atLeast = false): string {
    const text = count < 1000 ? exact.format(count) : compact.format(count).toLowerCase()
    return atLeast ? `${text}+` : text
  }

  static exact(count: number, atLeast = false): string {
    return atLeast ? `${exact.format(count)}+` : exact.format(count)
  }

  static plural(count: number, singular: string, pluralForm = `${singular}s`): string {
    return `${exact.format(count)} ${count === 1 ? singular : pluralForm}`
  }
}
