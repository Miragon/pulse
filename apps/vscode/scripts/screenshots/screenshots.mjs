import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { USE_CASES } from "./use-cases.mjs"
import { launchVsCode } from "./vscode-driver.mjs"

const OUTPUT = "docs/screenshots"
const SANDBOX_ENGINE = "http://localhost:18090/engine-rest/version"
const ONLY = process.env.PULSE_SCREENSHOTS

function fileName(index, useCase) {
  return `${String(index + 1).padStart(2, "0")}-${useCase.file}.png`
}

function indexPage(taken) {
  const rows = USE_CASES.map((useCase, index) => {
    const file = fileName(index, useCase)
    const cell = taken.has(file) ? `[${file}](${file})` : `${file} (not taken)`
    return `| ${index + 1} | ${useCase.title} | ${cell} | ${useCase.shows} |`
  })
  return [
    "# What Pulse can do, in screenshots",
    "",
    "Taken from VS Code against the shop sandbox (`sandbox/`). Recreate them with",
    "`pnpm --filter pulse-vscode run sandbox:up` followed by",
    "`pnpm --filter pulse-vscode run docs:screenshots`; with",
    "`PULSE_SCREENSHOTS=28-engine-overview` it takes only the shots whose file name contains that.",
    "",
    "| # | Use case | Screenshot | What it shows |",
    "| - | -------- | ---------- | ------------- |",
    ...rows,
    "",
    ...USE_CASES.flatMap((useCase, index) =>
      taken.has(fileName(index, useCase))
        ? [
            `## ${index + 1}. ${useCase.title}`,
            "",
            useCase.shows,
            "",
            `![${useCase.title}](${fileName(index, useCase)})`,
            "",
          ]
        : [],
    ),
  ].join("\n")
}

async function sandboxIsUp() {
  const response = await fetch(SANDBOX_ENGINE).catch(() => undefined)
  if (response?.ok !== true) {
    throw new Error(
      "The sandbox is not running. Start it with: pnpm --filter pulse-vscode run sandbox:up",
    )
  }
}

async function take(window, useCase, file) {
  process.stdout.write(`• ${file} … `)
  try {
    await useCase.run(window)
    await window.screenshot({ path: join(OUTPUT, file), scale: "css" })
    console.log("ok")
    return true
  } catch (error) {
    console.log(`failed: ${String(error).split("\n")[0]}`)
    return false
  } finally {
    await useCase.after?.(window).catch(() => undefined)
  }
}

async function shotsKept() {
  if (ONLY === undefined) {
    return []
  }
  return (await readdir(OUTPUT)).filter((file) => file.endsWith(".png"))
}

await sandboxIsUp()
await mkdir(OUTPUT, { recursive: true })
const selected = USE_CASES.map((useCase, index) => [useCase, fileName(index, useCase)]).filter(
  ([, file]) => ONLY === undefined || file.includes(ONLY),
)
const vscode = await launchVsCode("sandbox")
const taken = new Set(await shotsKept())
let succeeded = 0
try {
  for (const [useCase, file] of selected) {
    if (await take(vscode.window, useCase, file)) {
      taken.add(file)
      succeeded += 1
    }
  }
} finally {
  await vscode.close()
}
await writeFile(join(OUTPUT, "README.md"), `${indexPage(taken)}\n`)
console.log(`${succeeded} of ${selected.length} screenshots in ${OUTPUT}`)
process.exitCode = succeeded === selected.length ? 0 : 1
