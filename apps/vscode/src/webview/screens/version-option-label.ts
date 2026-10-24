import type { VersionOption } from "../../core/protocol/index.js"
import { CountLabels } from "../format/count-labels.js"

export class VersionOptionLabel {
  static of(option: VersionOption): string {
    const parts = [`v${option.version}`, `${CountLabels.exact(option.running)} running`]
    if (option.withIncident > 0) {
      parts.push(`${CountLabels.exact(option.withIncident)} with incident`)
    }
    return parts.join(" · ")
  }
}
