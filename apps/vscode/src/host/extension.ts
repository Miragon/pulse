import type * as vscode from "vscode"
import { PulseExtension } from "./pulse-extension.js"

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await new PulseExtension(context).activate()
}

export function deactivate(): void {
  return undefined
}
