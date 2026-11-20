import { describe, expect, test } from "vitest"
import { EngineScreen, ScreenJson } from "../src/builder/index.js"
import { FleetSums } from "../src/index.js"
import { WORLD_SCREENS } from "../src/testing/index.js"
import { ScreenWorld } from "./builder/support/world.js"

type FieldKind = "id" | "time" | "engineWord"

const STRING_FIELDS: Readonly<Record<string, FieldKind>> = {
  engine: "id",
  bpmnProcessId: "id",
  asOf: "time",
  name: "engineWord",
  product: "engineWord",
  version: "engineWord",
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

interface StringField {
  readonly path: string
  readonly key: string
  readonly value: string
}

class FormWalk {
  static strings(value: unknown, path = "$", key = ""): StringField[] {
    if (typeof value === "string") {
      return [{ path, key, value }]
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry: unknown, index) =>
        FormWalk.strings(entry, `${path}[${String(index)}]`, key),
      )
    }
    if (value !== null && typeof value === "object") {
      return Object.entries(value).flatMap(([name, entry]) =>
        FormWalk.strings(entry, `${path}.${name}`, name),
      )
    }
    return []
  }

  static findings(form: unknown, engineWords: ReadonlySet<string>): string[] {
    return FormWalk.strings(form).flatMap((field) => {
      const kind = STRING_FIELDS[field.key]
      if (kind === undefined) {
        return [`${field.path}: "${field.value}" is text of its own`]
      }
      return FormWalk.fits(kind, field.value, engineWords) ? [] : [`${field.path}: no ${kind}`]
    })
  }

  private static fits(kind: FieldKind, value: string, engineWords: ReadonlySet<string>): boolean {
    switch (kind) {
      case "id":
        return /^\S+$/.test(value)
      case "time":
        return ISO_TIME.test(value) && new Date(value).toISOString() === value
      case "engineWord":
        return engineWords.has(value)
    }
  }
}

async function worldForms(): Promise<{ readonly forms: unknown[]; readonly words: Set<string> }> {
  const runtime = ScreenWorld.world()
  const definitions = await runtime.listDefinitions()
  const info = await runtime.describeEngine()
  const screen = ScreenJson.engine(
    await EngineScreen.read("prod-a", runtime, () => ScreenWorld.AS_OF),
  )
  const bare = ScreenJson.engine(
    EngineScreen.of({
      engine: "prod-b",
      asOf: ScreenWorld.AS_OF,
      definitions: [ScreenWorld.summary("audit", { running: 1, withIncident: 0 })],
      info: undefined,
    }),
  )
  const words = new Set([
    info.product,
    info.version,
    ...definitions.flatMap(({ latest }) => (latest.name === undefined ? [] : [latest.name])),
  ])
  return { forms: [screen, bare, WORLD_SCREENS.engine, FleetSums.of([screen, bare])], words }
}

describe("the screens' JSON forms", () => {
  test("hold no text of their own: every text is an id, a time or a word the engine gave", async () => {
    const { forms, words } = await worldForms()

    expect(forms.flatMap((form) => FormWalk.findings(form, words))).toEqual([])
    expect(forms.flatMap((form) => FormWalk.strings(form)).length).toBeGreaterThan(20)
  })

  test("are held to it by a walk that finds a planted text, a wrong time and a word no engine gave", async () => {
    const { words } = await worldForms()
    const planted = {
      engine: "prod-a",
      asOf: "2026-11-19 09:00",
      info: { product: "Unknown engine", version: "1.0.0" },
      summary: "3 processes · 5 running",
      processes: [{ bpmnProcessId: "with space" }],
    }

    expect(FormWalk.findings(planted, words)).toEqual([
      "$.asOf: no time",
      "$.info.product: no engineWord",
      '$.summary: "3 processes · 5 running" is text of its own',
      "$.processes[0].bpmnProcessId: no id",
    ])
  })
})
