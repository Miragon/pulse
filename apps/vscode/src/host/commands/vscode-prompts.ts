import * as vscode from "vscode"
import type { PromptInput, PromptItem, Prompts } from "./prompts.js"

type PickItem<T> = vscode.QuickPickItem & { readonly item: T }

export class VsCodePrompts implements Prompts {
  async input(options: PromptInput): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: options.title,
      prompt: options.prompt,
      value: options.value,
      password: options.password,
      ignoreFocusOut: true,
      validateInput: options.validate,
    })
  }

  async pick<T>(
    title: string,
    items: readonly PromptItem<T>[],
    question?: string,
  ): Promise<T | undefined> {
    const chosen = await vscode.window.showQuickPick(
      items.map((item) => VsCodePrompts.pickItemOf(item)),
      { title, ignoreFocusOut: true, ...(question === undefined ? {} : { placeHolder: question }) },
    )
    return chosen?.item
  }

  private static pickItemOf<T>(item: PromptItem<T>): PickItem<T> {
    return {
      label: item.label,
      item: item.item,
      ...(item.description === undefined ? {} : { description: item.description }),
      ...(item.detail === undefined ? {} : { detail: item.detail }),
    }
  }
}
