import type { WebviewIntent } from "../protocol/index.js"
import type { PlanNavigation } from "./plan-context.js"

export class PlanIntents {
  static forward(navigation: PlanNavigation, intent: WebviewIntent): void {
    switch (intent.type) {
      case "goBack":
        navigation.goBack()
        return
      case "copy":
        navigation.copy(intent.text, intent.label)
        return
      case "editConnection":
        navigation.editConnection()
        return
      case "setCredentials":
        navigation.setCredentials()
        return
      default:
        return
    }
  }
}
