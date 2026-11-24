import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { MigrationPlanFiles, MigrationPlanParser } from "@miragon/pulse-migration-plan"
import { MIGRATION_PLAN_FIXTURES } from "@miragon/pulse-migration-plan/testing"
import { describe, expect, test, vi } from "vitest"
import type * as vscode from "vscode"
import { COMMAND } from "../../src/host/commands/command-ids.js"
import { PlanFiles } from "../../src/host/plans/plan-files.js"
import { APP_ROOT } from "./support/files.js"

vi.mock("vscode", () => import("../host/support/vscode-fake.js"))

const COPY = "schemas/migration-plan.schema.json"
const SOURCE = "@miragon/pulse-migration-plan/schema/migration-plan.schema.json"

interface MenuEntry {
  readonly command: string
  readonly when?: string
  readonly group?: string
}

const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
  readonly contributes: {
    readonly commands: readonly { readonly command: string; readonly title: string }[]
    readonly menus: Readonly<Record<string, readonly MenuEntry[]>>
    readonly jsonValidation: readonly { fileMatch: string; url: string }[]
  }
}

const PLAN_FILE = `resourceFilename =~ /${MigrationPlanFiles.SUFFIX.replaceAll(".", "\\.")}$/`

function uriOf(path: string): vscode.Uri {
  return { path, toString: () => `file://${path}` } as unknown as vscode.Uri
}

function previewEntries(menu: string): readonly MenuEntry[] {
  return (manifest.contributes.menus[menu] ?? []).filter(
    (entry) => entry.command === COMMAND.previewMigrationPlan,
  )
}

describe("the migration plan schema the editor validates with", () => {
  test("is the plan format's schema, copied byte for byte", () => {
    const source = createRequire(join(APP_ROOT, "package.json")).resolve(SOURCE)

    expect(
      readFileSync(join(APP_ROOT, COPY), "utf8"),
      `apps/vscode/${COPY} differs from ${SOURCE}: copy packages/core/migration-plan/schema/migration-plan.schema.json to apps/vscode/${COPY}`,
    ).toBe(readFileSync(source, "utf8"))
  })

  test("is the one the extension contributes for the plan files of .pulse/migrations", () => {
    expect(manifest.contributes.jsonValidation).toContainEqual({
      fileMatch: `**/${MigrationPlanFiles.FOLDER}/*${MigrationPlanFiles.SUFFIX}`,
      url: `./${COPY}`,
    })
  })

  test("ships in the .vsix", () => {
    expect(readFileSync(join(APP_ROOT, ".vscodeignore"), "utf8").split("\n")).toContain(`!${COPY}`)
  })

  test("holds the format's full plan, whose file lands where the extension validates and previews it", () => {
    const full = MIGRATION_PLAN_FIXTURES.find((fixture) => fixture.name === "full")
    const parsed = MigrationPlanParser.parse(full?.text ?? "")
    const path = "plan" in parsed ? MigrationPlanFiles.pathOf(parsed.plan) : ""

    expect(full?.schema).toBe(true)
    expect(parsed).toEqual(full?.verdict)
    expect(path.startsWith(`${MigrationPlanFiles.FOLDER}/`)).toBe(true)
    expect(PlanFiles.isPlan(uriOf(`/w/${path}`))).toBe(true)
  })
})

describe("the plan files the extension previews", () => {
  test("end in the format's suffix, which the host keeps a copy of", () => {
    expect(PlanFiles.SUFFIX).toBe(MigrationPlanFiles.SUFFIX)
  })

  test.each([
    "/w/.pulse/migrations/invoice-v1-to-v2.migration.json",
    "/w/plans/invoice.migration.json",
    "/w/.migration.json",
    "/w/invoice.json",
    "/w/invoice.migration.json.bak",
  ])("are told by their name as the format tells them: %s", (path) => {
    expect(PlanFiles.isPlan(uriOf(path))).toBe(MigrationPlanFiles.isPlanPath(path))
  })

  test("offer the preview in the command palette, the explorer and the editor's title for a plan file only", () => {
    const command = manifest.contributes.commands.find(
      (entry) => entry.command === COMMAND.previewMigrationPlan,
    )

    expect(command?.title).toBe("Preview Migration Plan…")
    expect(previewEntries("commandPalette")).toEqual([
      { command: COMMAND.previewMigrationPlan, when: PLAN_FILE },
    ])
    for (const menu of ["explorer/context", "editor/title"]) {
      expect(previewEntries(menu), menu).toEqual([
        { command: COMMAND.previewMigrationPlan, when: PLAN_FILE, group: "navigation@90" },
      ])
    }
  })
})
