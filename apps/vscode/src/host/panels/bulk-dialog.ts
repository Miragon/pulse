import type { BulkAnswer, BulkRequest } from "../../core/index.js"
import * as vscode from "vscode"
import type { Confirmation } from "../connections/confirmation-policy.js"
import { NotificationText } from "../notification-text.js"
import { WriteDialog, type WriteTargetEngine } from "./write-dialog.js"

const MAX_REASON_LENGTH = 500

export class BulkDialog {
  private readonly dialog: WriteDialog

  constructor(
    private readonly request: BulkRequest,
    private readonly engine: WriteTargetEngine,
  ) {
    this.dialog = new WriteDialog(request, engine)
  }

  async confirm(confirmation: Confirmation): Promise<BulkAnswer | undefined> {
    if (!(await this.dialog.confirmedInModal()) || !(await this.countTyped())) {
      return undefined
    }
    if (confirmation === "typeHost" && !(await this.dialog.hostTyped())) {
      return undefined
    }
    return this.reasonFor(confirmation)
  }

  private async countTyped(): Promise<boolean> {
    const count = String(this.request.count)
    const engine = this.engine
    const typed = await vscode.window.showInputBox({
      title: this.request.countPrompt,
      prompt: `${NotificationText.printable(engine.name)} (${engine.environment}) · ${engine.host}. ${this.request.warning}`,
      ignoreFocusOut: true,
      validateInput: (value) => (value === "" || value === count ? undefined : `Type ${count}`),
    })
    return typed === count
  }

  private async reasonFor(confirmation: Confirmation): Promise<BulkAnswer | undefined> {
    if (!this.request.takesReason || confirmation === "none") {
      return {}
    }
    const required = confirmation === "typeHost"
    const typed = await vscode.window.showInputBox({
      title: required ? "Reason (required on this engine)" : "Reason (optional)",
      prompt: this.request.reasonPrompt,
      ignoreFocusOut: true,
      validateInput: (value) => this.reasonProblem(value, required),
    })
    if (typed === undefined) {
      return undefined
    }
    const reason = this.cleaned(typed)
    return reason === "" ? {} : { reason }
  }

  private reasonProblem(value: string, required: boolean): string | undefined {
    const reason = this.cleaned(value)
    if (required && reason === "") {
      return "Give a reason to go ahead"
    }
    return reason.length > MAX_REASON_LENGTH ? `At most ${MAX_REASON_LENGTH} characters` : undefined
  }

  private cleaned(value: string): string {
    return NotificationText.printable(value).trim()
  }
}
