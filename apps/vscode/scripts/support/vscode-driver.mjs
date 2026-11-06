import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { downloadAndUnzipVSCode } from "@vscode/test-electron"
import { _electron as electron } from "playwright"

const EXTENSION = resolve(".")
const SHOTS = resolve(process.env.PULSE_E2E_SHOTS ?? "test-results/e2e")
const MAC_INSTALLATION = "/Applications/Visual Studio Code.app/Contents/MacOS/Code"

async function vscodeExecutable() {
  if (process.env.PULSE_VSCODE_EXECUTABLE !== undefined) {
    return process.env.PULSE_VSCODE_EXECUTABLE
  }
  return existsSync(MAC_INSTALLATION) ? MAC_INSTALLATION : downloadAndUnzipVSCode("stable")
}

export async function shot(window, name) {
  await window.screenshot({ path: join(SHOTS, `${name}.png`) })
  console.log(`screenshot ${name}.png`)
}

export async function panelFrame(window) {
  const outer = window.frameLocator("iframe.webview.ready").last()
  return outer.frameLocator("iframe#active-frame")
}

export async function runCommand(window, title) {
  await window.locator(".statusbar").click({ position: { x: 800, y: 8 } })
  await window.keyboard.press(process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P")
  await window.keyboard.type(title)
  await window
    .locator(".quick-input-list .monaco-list-row.focused", { hasText: title })
    .waitFor({ timeout: 10_000 })
  await window.keyboard.press("Enter")
}

async function step(name, action, window) {
  process.stdout.write(`• ${name} … `)
  try {
    await action()
  } catch (error) {
    await shot(window, "failed-step")
    throw error
  }
  console.log("ok")
}

async function launch(workspace, userData) {
  return electron.launch({
    executablePath: await vscodeExecutable(),
    args: [
      workspace,
      `--extensionDevelopmentPath=${EXTENSION}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${join(userData, "extensions")}`,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-telemetry",
      "--new-window",
      ...(process.env.PULSE_VSCODE_NO_SANDBOX === "1"
        ? ["--no-sandbox", "--password-store=basic"]
        : []),
    ],
  })
}

export async function driveVscode(workspace, steps) {
  await mkdir(SHOTS, { recursive: true })
  const userData = await mkdtemp(join(tmpdir(), "pulse-e2e-"))
  const app = await launch(workspace, userData)
  const window = await app.firstWindow()
  try {
    for (const [name, action] of steps) {
      await step(name, () => action(window), window)
    }
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
}
