import { CountLabels } from "../format/count-labels.js"

export type BadgeVariant = "incident" | "propagated" | "running"

export class BadgeDescription {
  static of(variant: BadgeVariant, count: number, elementName: string): string {
    return `${elementName}: ${BadgeDescription.countOf(variant, count)}. ${BadgeDescription.actionOf(variant)}`
  }

  private static countOf(variant: BadgeVariant, count: number): string {
    if (variant === "running") {
      return `${CountLabels.plural(count, "instance")} running`
    }
    const incidents = CountLabels.plural(count, "incident")
    return variant === "incident" ? incidents : `${incidents} in called instances`
  }

  private static actionOf(variant: BadgeVariant): string {
    return variant === "running"
      ? "Show the running instances here."
      : "Show the instances with an incident here."
  }
}
