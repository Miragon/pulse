import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { BoardParser } from "../../src/core/boards/board-parser.js"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"
import { StackFrames } from "../../src/host/panels/stack-frames.js"
import { WorkspaceCodeLocator } from "../../src/model/code/workspace-code-locator.js"
import { MemoryFiles } from "../model/support/memory-files.js"
import { APP_ROOT } from "./support/files.js"

interface Seed {
  readonly businessIdsOf: (scenarios: readonly unknown[]) => readonly string[]
}

interface Scenarios {
  readonly SHOP_DEV_SCENARIOS: readonly unknown[]
  readonly SHOP_TEST_SCENARIOS: readonly unknown[]
}

interface ErrorTexts {
  readonly cardExpiredText: (orderId: string, message: string) => string
  readonly carrierRejectedText: (message: string) => string
}

const SANDBOX = join(APP_ROOT, "sandbox-c8")
const SCRIPTS = join(APP_ROOT, "scripts/sandbox-c8")
const WORKSPACE = "file:///workspace"
const PROJECT_MODELS = "src/main/resources/bpmn"
const SEED = new URL("../../scripts/sandbox-c8/seed.mjs", import.meta.url).href
const SCENARIOS = new URL("../../scripts/sandbox-c8/scenarios.mjs", import.meta.url).href
const ERROR_TEXTS = new URL("../../scripts/sandbox-c8/error-texts.mjs", import.meta.url).href

function read(directory: string, path: string): string {
  return readFileSync(join(directory, path), "utf8")
}

function filesIn(directory: string, extension: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(extension))
    .sort()
}

function sandboxFiles(): MemoryFiles {
  return new MemoryFiles(
    Object.fromEntries(
      filesIn(SANDBOX, ".java").map((path) => [`${WORKSPACE}/${path}`, read(SANDBOX, path)]),
    ),
  )
}

function lineAt(uri: string, line: number): string {
  return read(SANDBOX, uri.slice(WORKSPACE.length + 1)).split("\n")[line - 1] ?? ""
}

function modelTexts(): string[] {
  return [
    ...filesIn(join(SANDBOX, PROJECT_MODELS), ".bpmn").map((path) =>
      read(join(SANDBOX, PROJECT_MODELS), path),
    ),
    ...filesIn(join(SCRIPTS, "deployed"), ".bpmn").map((path) =>
      read(join(SCRIPTS, "deployed"), path),
    ),
  ]
}

function jobTypes(): string[] {
  const types = modelTexts().flatMap((xml) =>
    [...xml.matchAll(/zeebe:taskDefinition type="([^"]+)"/g)].map((match) => match[1] ?? ""),
  )
  return [...new Set(types)].sort()
}

describe("the Camunda 8 sandbox", () => {
  const parsed = new TargetsParser(".pulse-cli.json").parse(read(SANDBOX, ".pulse-cli.json"))
  const profiles = parsed.targets.map((target) => target.name)

  test("names three Camunda 8 profiles the extension reads without a problem", () => {
    expect(parsed.problems).toEqual([])
    expect(parsed.targets.map((target) => [target.name, target.engine])).toEqual([
      ["shop-dev", "c8"],
      ["shop-test", "c8"],
      ["prod-eu", "c8"],
    ])
  })

  test("classifies and boards only the profiles it names", () => {
    const settings = JSON.parse(read(SANDBOX, ".vscode/settings.json")) as {
      readonly "pulse.environments": Readonly<Record<string, string>>
    }

    expect(Object.keys(settings["pulse.environments"])).toEqual(["shop-test", "prod-eu"])
    expect(
      BoardParser.parse(read(SANDBOX, ".pulse/boards/shop-operations.board.json")),
    ).toHaveProperty("board.engines", profiles)
    expect(
      BoardParser.parse(read(SANDBOX, ".pulse/boards/order-fulfillment.board.json")),
    ).toHaveProperty("board.engines", ["shop-dev", "shop-test"])
  })

  test("opens the worker of every job type the seed runs, and only two job types have none", async () => {
    const locator = new WorkspaceCodeLocator(sandboxFiles())
    const found = await Promise.all(
      jobTypes().map(async (taskType) => {
        const location = await locator.locate({ kind: "workerTask", taskType })
        return [taskType, location === undefined ? undefined : lineAt(location.uri, location.line)]
      }),
    )

    expect(Object.fromEntries(found)).toEqual({
      "book-carrier": '    @JobWorker(type = "book-carrier")',
      "charge-payment": '    @JobWorker(type = "charge-payment")',
      "create-return-label": undefined,
      "notify-customer": undefined,
      "reserve-stock": '    @JobWorker(type = "reserve-stock")',
    })
  })

  test("its stack traces point at lines and classes of its own sources", async () => {
    const texts = (await import(ERROR_TEXTS)) as ErrorTexts
    const trace = [
      texts.cardExpiredText("ORD-10129", "Card ending 1234 expired on 03/2025"),
      texts.carrierRejectedText("Carrier rejected parcel for ORD-10142"),
    ].join("\n")
    const files = sandboxFiles()
    const shopFrames = StackFrames.in(trace).filter((frame) => frame.sourceGlob.includes("miragon"))
    const lines = await Promise.all(
      shopFrames.map(async (frame) => {
        const [uri = ""] = await files.find(frame.sourceGlob, 1)
        return lineAt(uri, frame.sourceLine).trim()
      }),
    )
    const locator = new WorkspaceCodeLocator(files)
    const classes = StackFrames.classesIn(trace)
      .map((mention) => mention.className)
      .filter((className) => className.startsWith("io.miragon."))
    const declared = await Promise.all(
      [...new Set(classes)].map((className) => locator.locate({ kind: "class", className })),
    )

    expect(lines).toEqual([
      'throw new PaymentFailedException("Payment for order " + orderId + " failed", expired);',
      "String paymentId = charge(orderId, cardLast4, cardExpiry, BigDecimal.valueOf(amount));",
      'throw new CardExpiredException("Card ending " + cardLast4 + " expired on " + cardExpiry);',
      "return gateway.authorize(cardLast4, cardExpiry, amount);",
      'throw new CarrierRejectedException("Carrier rejected parcel for " + orderId + ": "',
    ])
    expect(new Set(classes).size).toBe(6)
    expect(declared.filter((location) => location === undefined)).toEqual([])
  })

  test("its charter names only business keys the seed starts", async () => {
    const { businessIdsOf } = (await import(SEED)) as Seed
    const { SHOP_DEV_SCENARIOS, SHOP_TEST_SCENARIOS } = (await import(SCENARIOS)) as Scenarios
    const started = new Set([
      ...businessIdsOf(SHOP_DEV_SCENARIOS),
      ...businessIdsOf(SHOP_TEST_SCENARIOS),
    ])
    const named = [...read(SANDBOX, "README.md").matchAll(/\b(?:ORD|RET)-\d+\b/g)].map(
      (match) => match[0],
    )

    expect(named).not.toEqual([])
    expect(named.filter((key) => !started.has(key))).toEqual([])
  })

  test("deploys every element its scripts and boards name", () => {
    const sources = [
      ...filesIn(SCRIPTS, ".mjs").map((path) => read(SCRIPTS, path)),
      ...filesIn(join(SANDBOX, ".pulse/boards"), ".json").map((path) =>
        read(join(SANDBOX, ".pulse/boards"), path),
      ),
    ]
    const named = sources.flatMap((source) =>
      [...source.matchAll(/"((?:Activity|Gateway|Event)_\w+)"/g)].map((match) => match[1] ?? ""),
    )
    const models = modelTexts().join("\n")

    expect(named).not.toEqual([])
    expect(named.filter((id) => !models.includes(`id="${id}"`))).toEqual([])
  })
})
