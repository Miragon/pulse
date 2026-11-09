import { execFileSync } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const SCRIPT = fileURLToPath(new URL("../scripts/release-notes.mjs", import.meta.url))

const CHANGELOG = `# Changelog

## [0.28.0](https://github.com/Miragon/pulse/compare/v0.27.1...v0.28.0) (2026-11-08)


### Features

* **cli:** a new command ([#1](https://github.com/Miragon/pulse/issues/1))
* **orca:** the panel lists boards ([#2](https://github.com/Miragon/pulse/issues/2))


### Bug Fixes

* **engine:** a server fix ([#3](https://github.com/Miragon/pulse/issues/3))
* **runtime-view:** a tab keeps its scroll position ([#4](https://github.com/Miragon/pulse/issues/4))

## [0.27.1](https://github.com/Miragon/pulse/compare/v0.27.0...v0.27.1) (2026-11-07)


### Bug Fixes

* **orca:** an older fix ([#5](https://github.com/Miragon/pulse/issues/5))
`

async function notesFor(
  changelog: string,
  ...args: string[]
): Promise<{ tag: string; changelog: string }> {
  const file = join(await mkdtemp(join(tmpdir(), "pulse-orca-notes-")), "CHANGELOG.md")
  await writeFile(file, changelog)
  return JSON.parse(
    execFileSync(process.execPath, [SCRIPT, file, ...args], { encoding: "utf8" }),
  ) as {
    tag: string
    changelog: string
  }
}

describe("the catalog's release notes", () => {
  test("keep the plugin's lines of the release's section under their headings, and link the release", async () => {
    const notes = await notesFor(CHANGELOG, "v0.28.0", "Miragon/pulse")

    expect(notes).toEqual({
      tag: "v0.28.0",
      changelog: [
        "### Features",
        "",
        "* **orca:** the panel lists boards ([#2](https://github.com/Miragon/pulse/issues/2))",
        "",
        "### Bug Fixes",
        "",
        "* **runtime-view:** a tab keeps its scroll position ([#4](https://github.com/Miragon/pulse/issues/4))",
        "",
        "[Every change of Pulse v0.28.0](https://github.com/Miragon/pulse/releases/tag/v0.28.0)",
      ].join("\n"),
    })
  })

  test("read the section of the tag, not the newest one", async () => {
    const notes = await notesFor(CHANGELOG, "v0.27.1")

    expect(notes.changelog).toContain("an older fix")
    expect(notes.changelog).not.toContain("the panel lists boards")
  })

  test("say so when the release leaves the plugin as it was", async () => {
    const notes = await notesFor(
      CHANGELOG.replaceAll("**orca:**", "**cli:**").replaceAll("**runtime-view:**", "**cli:**"),
      "v0.28.0",
    )

    expect(notes.changelog.split("\n\n")[0]).toBe("No change to the Orca plugin itself.")
  })

  test("stay within the catalog's limit and keep the link", async () => {
    const many = Array.from(
      { length: 80 },
      (_, index) => `* **orca:** change number ${String(index)} of a long release`,
    )
    const notes = await notesFor(
      `# Changelog\n\n## [1.0.0](x)\n\n### Features\n\n${many.join("\n")}\n`,
      "v1.0.0",
    )

    expect(notes.changelog.length).toBeLessThanOrEqual(1900)
    expect(notes.changelog).toMatch(
      /\* \*\*orca:\*\* change number \d+ of a long release\n\n\[Every change of Pulse v1\.0\.0\]/,
    )
  })

  test("take the newest section on a dry run, without a tag or a link", async () => {
    const notes = await notesFor(CHANGELOG)

    expect(notes.tag).toBe("")
    expect(notes.changelog).toContain("the panel lists boards")
    expect(notes.changelog).not.toContain("[Every change")
  })
})
