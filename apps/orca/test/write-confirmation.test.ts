import { describe, expect, test } from "vitest"
import type { BulkRequest, WriteRequest } from "@miragon/pulse-runtime-view/core"
import {
  type Connection,
  LOCAL_TARGET,
  type EngineTarget,
  WriteAudit,
  type EnvironmentSettings,
} from "@miragon/pulse-runtime-view/host-kit"
import type { Prompt, PromptAnswer } from "../src/protocol.js"
import { Prompts } from "../src/worker/prompts.js"
import { WriteConfirmation } from "../src/worker/write-confirmation.js"

const REMOTE: EngineTarget = {
  ...LOCAL_TARGET,
  name: "prod-eu",
  endpoint: "https://prod-eu.shop.example/engine-rest",
}

const RETRY: WriteRequest = {
  action: "retryIncident",
  title: "Retry the incident at Charge payment?",
  facts: ["Retries 0 → 1"],
  confirmLabel: "Retry",
}

const CANCEL: BulkRequest = {
  action: "cancelInstances",
  title: "Cancel 2 instances?",
  facts: [],
  confirmLabel: "Cancel 2 instances",
  selected: 2,
  count: 2,
  countPrompt: "Type 2 to cancel 2 instances",
  warning: "Cancelling can't be undone.",
  takesReason: true,
  reasonPrompt: "Why?",
}

const NO_SETTINGS: EnvironmentSettings = { user: undefined, workspace: [] }

class Harness {
  readonly lines: string[] = []
  readonly asked: Prompt[] = []
  readonly prompts = new Prompts(() => undefined)
  readonly confirmation: WriteConfirmation

  constructor(settings: EnvironmentSettings = NO_SETTINGS) {
    this.confirmation = new WriteConfirmation(
      this.prompts,
      new WriteAudit({ info: (line) => this.lines.push(line) }),
      () => settings,
    )
  }

  connectionOf(target: EngineTarget, host: string): Connection {
    return {
      target,
      badge: { name: target.name, environment: "unclassified", host },
    } as unknown as Connection
  }

  async answer(answer: (prompt: Prompt) => PromptAnswer): Promise<void> {
    await Promise.resolve()
    const [prompt] = this.prompts.list()
    if (prompt !== undefined) {
      this.asked.push(prompt)
      this.prompts.answer(prompt.id, answer(prompt))
    }
  }
}

describe("confirming a write in the Pulse panel", () => {
  test("a retry on a local engine needs no confirmation", async () => {
    const harness = new Harness()

    const confirmed = await harness.confirmation.confirm(
      harness.connectionOf(LOCAL_TARGET, "localhost:8080"),
      RETRY,
    )

    expect(confirmed).toBe(true)
    expect(harness.prompts.list()).toEqual([])
    expect(harness.lines[0]).toMatch(/confirmation=none answer=confirmed$/)
  })

  test("an engine marked test asks before the write and names the engine", async () => {
    const harness = new Harness({ user: undefined, workspace: [{ local: "test" }] })
    const asking = harness.confirmation.confirm(
      harness.connectionOf(LOCAL_TARGET, "localhost:8080"),
      RETRY,
    )
    await harness.answer(() => ({ kind: "confirm", confirmed: true }))

    expect(await asking).toBe(true)
    expect(harness.asked[0]).toMatchObject({ kind: "confirm", confirmLabel: "Retry" })
    expect(harness.asked[0]?.kind === "confirm" && harness.asked[0].facts.at(-1)).toBe(
      "Engine local · localhost:8080",
    )
    expect(harness.lines[0]).toMatch(/confirmation=modal answer=confirmed$/)
  })

  test("a remote engine needs its host typed", async () => {
    const harness = new Harness()
    const connection = harness.connectionOf(REMOTE, "prod-eu.shop.example")

    const wrongHost = harness.confirmation.confirm(connection, RETRY)
    await harness.answer(() => ({ kind: "confirm", confirmed: true, typedHost: "prod-eu" }))
    const rightHost = harness.confirmation.confirm(connection, RETRY)
    await harness.answer(() => ({
      kind: "confirm",
      confirmed: true,
      typedHost: "prod-eu.shop.example",
    }))

    expect(await wrongHost).toBe(false)
    expect(await rightHost).toBe(true)
    expect(harness.asked[0]).toMatchObject({ typeHost: "prod-eu.shop.example" })
  })

  test("cancelling records a cancelled answer", async () => {
    const harness = new Harness({ user: undefined, workspace: [{ local: "test" }] })
    const asking = harness.confirmation.confirm(
      harness.connectionOf(LOCAL_TARGET, "localhost:8080"),
      RETRY,
    )
    await harness.answer(() => ({ kind: "confirm", confirmed: false }))

    expect(await asking).toBe(false)
    expect(harness.lines[0]).toMatch(/answer=cancelled$/)
  })
})

describe("confirming a bulk write", () => {
  test("goes ahead only with the count typed", async () => {
    const harness = new Harness()
    const connection = harness.connectionOf(LOCAL_TARGET, "localhost:8080")

    const wrongCount = harness.confirmation.confirmBulk(connection, CANCEL)
    await harness.answer(() => ({ kind: "bulk", confirmed: true, typedCount: "3" }))
    const rightCount = harness.confirmation.confirmBulk(connection, CANCEL)
    await harness.answer(() => ({
      kind: "bulk",
      confirmed: true,
      typedCount: "2",
      reason: " cleanup ",
    }))

    expect(await wrongCount).toBeUndefined()
    expect(await rightCount).toEqual({})
    expect(harness.lines.at(-1)).toMatch(
      /confirmation=typeCount answer=confirmed selected=2 skipped=0 count=2$/,
    )
  })

  test("a remote engine asks for host, count and a reason", async () => {
    const harness = new Harness()
    const connection = harness.connectionOf(REMOTE, "prod-eu.shop.example")

    const noReason = harness.confirmation.confirmBulk(connection, CANCEL)
    await harness.answer(() => ({
      kind: "bulk",
      confirmed: true,
      typedCount: "2",
      typedHost: "prod-eu.shop.example",
    }))
    const withReason = harness.confirmation.confirmBulk(connection, CANCEL)
    await harness.answer(() => ({
      kind: "bulk",
      confirmed: true,
      typedCount: "2",
      typedHost: "prod-eu.shop.example",
      reason: "Duplicates from the import",
    }))

    expect(await noReason).toBeUndefined()
    expect(await withReason).toEqual({ reason: "Duplicates from the import" })
    expect(harness.asked[0]).toMatchObject({
      reason: { required: true },
      typeHost: "prod-eu.shop.example",
    })
  })
})
