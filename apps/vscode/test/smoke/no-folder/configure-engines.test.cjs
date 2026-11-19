const assert = require("node:assert")
const { readFileSync, statSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join, relative } = require("node:path")
const vscode = require("vscode")

function temporaryConfigHome() {
  const home = process.env.XDG_CONFIG_HOME
  assert.ok(home !== undefined && !relative(tmpdir(), home).startsWith(".."), home)
  assert.strictEqual(process.env.PULSE_CLI_CONFIG ?? "", "")
  return home
}

suite("Pulse in VS Code without a folder", () => {
  test("runs in a window without a folder", () => {
    assert.strictEqual(vscode.workspace.workspaceFolders, undefined)
  })

  test("opens the CLI's user config in a temporary config folder: created private, with a profile to fill in", async () => {
    const own = join(temporaryConfigHome(), "pulse-cli", "config.json")
    try {
      await vscode.commands.executeCommand("pulse.openTargetsFile")
      const editor = vscode.window.activeTextEditor
      assert.strictEqual(editor?.document.uri.fsPath, own)
      assert.match(editor.document.getText(), /"url": "https:\/\/dev\.example\.com\/engine-rest"/)
      assert.strictEqual(readFileSync(own, "utf8"), '{\n  "profiles": {}\n}\n')
      if (process.platform !== "win32") {
        assert.strictEqual(statSync(own).mode & 0o777, 0o600)
      }
    } finally {
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor")
    }
  })
})
