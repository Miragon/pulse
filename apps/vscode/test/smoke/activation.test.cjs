const assert = require("node:assert")
const { readFileSync } = require("node:fs")
const { tmpdir } = require("node:os")
const { join, relative } = require("node:path")
const vscode = require("vscode")

const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"))

const PROFILES = new TextEncoder().encode(
  JSON.stringify({ profiles: { smoke: { url: "http://localhost:8080/engine-rest" } } }),
)

function workspaceFile(...segments) {
  return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ...segments)
}

async function writeProjectFile(folder, name) {
  await vscode.workspace.fs.createDirectory(workspaceFile(folder))
  await vscode.workspace.fs.writeFile(workspaceFile(folder, name), PROFILES)
  return workspaceFile(folder, name)
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function temporaryConfigHome() {
  const home = process.env.XDG_CONFIG_HOME
  assert.ok(home !== undefined && !relative(tmpdir(), home).startsWith(".."), home)
  assert.strictEqual(process.env.PULSE_CLI_CONFIG ?? "", "")
  return home
}

async function settled(running) {
  let done = false
  const command = Promise.resolve(running).finally(() => {
    done = true
  })
  await pause(1000)
  if (!done) {
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen")
  }
  await command
}

async function configureEnginesOpens(expected) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await vscode.commands.executeCommand("pulse.refresh")
    await settled(vscode.commands.executeCommand("pulse.openTargetsFile", expected.fsPath))
    if (vscode.window.activeTextEditor?.document.uri.fsPath === expected.fsPath) {
      return
    }
    await pause(250)
  }
  assert.strictEqual(vscode.window.activeTextEditor?.document.uri.fsPath, expected.fsPath)
}

async function configureEnginesChoosingTheFirst() {
  let done = false
  const command = Promise.resolve(vscode.commands.executeCommand("pulse.openTargetsFile")).finally(
    () => {
      done = true
    },
  )
  for (let attempt = 0; attempt < 40 && !done; attempt += 1) {
    await pause(250)
    await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem")
  }
  await command
}

async function removeAll(uris) {
  for (const uri of uris) {
    await Promise.resolve(
      vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false }),
    ).catch(() => undefined)
  }
}

suite("Pulse in VS Code", () => {
  test("activates and registers every contributed command", async () => {
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`)
    assert.ok(extension, "the extension is installed")
    await extension.activate()
    const registered = await vscode.commands.getCommands(true)
    for (const { command } of manifest.contributes.commands) {
      assert.ok(registered.includes(command), `${command} is registered`)
    }
  })

  test("shows the Engines view without any configuration", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.pulse")
    await vscode.commands.executeCommand("pulse.refresh")
  })

  test("finds the project file under its current and its former name", async () => {
    try {
      const former = await writeProjectFile("former", ".pulse-cli.json")
      await configureEnginesOpens(former)
      await assert.rejects(async () => vscode.workspace.fs.stat(workspaceFile(".pulse.json")))
      await configureEnginesOpens(await writeProjectFile("current", ".pulse.json"))
    } finally {
      await removeAll([
        workspaceFile("former"),
        workspaceFile("current"),
        workspaceFile(".pulse.json"),
      ])
    }
  })

  test("asks which file gets the engines and writes the project file of this folder", async () => {
    try {
      await vscode.commands.executeCommand("pulse.refresh")
      await configureEnginesChoosingTheFirst()
      assert.strictEqual(
        vscode.window.activeTextEditor?.document.uri.fsPath,
        workspaceFile(".pulse.json").fsPath,
      )
      await vscode.workspace.fs.stat(workspaceFile(".pulse.json"))
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors")
      await removeAll([workspaceFile(".pulse.json")])
    }
  })

  test("reads the engines of the CLI's user config in a temporary config folder", async () => {
    const folder = vscode.Uri.file(join(temporaryConfigHome(), "pulse-cli"))
    const own = vscode.Uri.joinPath(folder, "config.json")
    try {
      await vscode.workspace.fs.createDirectory(folder)
      await vscode.workspace.fs.writeFile(own, PROFILES)
      await configureEnginesOpens(own)
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors")
      await removeAll([folder])
    }
  })
})
