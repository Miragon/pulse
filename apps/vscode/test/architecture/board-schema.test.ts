import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { BoardParser } from "@miragon/pulse-board"
import { APP_ROOT } from "./support/files.js"

const COPY = "schemas/board.schema.json"
const SOURCE = "@miragon/pulse-board/schema/board.schema.json"

const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
  readonly contributes: { readonly jsonValidation: readonly { fileMatch: string; url: string }[] }
}

describe("the board schema the editor validates with", () => {
  test("is the board format's schema, copied byte for byte", () => {
    const source = createRequire(join(APP_ROOT, "package.json")).resolve(SOURCE)

    expect(
      readFileSync(join(APP_ROOT, COPY), "utf8"),
      `apps/vscode/${COPY} differs from ${SOURCE}: copy packages/core/board/schema/board.schema.json to apps/vscode/${COPY}`,
    ).toBe(readFileSync(source, "utf8"))
  })

  test("is the one the extension contributes for board files", () => {
    expect(manifest.contributes.jsonValidation).toEqual([
      { fileMatch: "**/.pulse/boards/*.board.json", url: `./${COPY}` },
    ])
  })

  test("reads the board the sandbox ships", () => {
    const content = readFileSync(
      join(APP_ROOT, "sandbox/.pulse/boards/shop-operations.board.json"),
      "utf8",
    )

    expect(BoardParser.parse(content)).toHaveProperty("board.engines", [
      "shop-dev",
      "shop-test",
      "prod-eu",
    ])
  })
})
