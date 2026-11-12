import { describe, expect, test } from "vitest"
import { ProjectFile } from "../../src/host-kit/connections/project-file.js"

describe("the project file", () => {
  test("is .pulse.json, and .pulse-cli.json was its name", () => {
    expect(ProjectFile.NAME).toBe(".pulse.json")
    expect(ProjectFile.FORMER_NAME).toBe(".pulse-cli.json")
    expect(ProjectFile.RENAME).toBe(
      "Pulse reads .pulse.json now. Rename this file to .pulse.json; its content stays.",
    )
  })

  test("is current only under its name", () => {
    expect(ProjectFile.isCurrent("/work/.pulse.json")).toBe(true)
    expect(ProjectFile.isCurrent("/work/.pulse-cli.json")).toBe(false)
    expect(ProjectFile.isCurrent("/work/x.pulse.json")).toBe(false)
  })

  test("names a former file only in a folder without a current one", () => {
    expect(
      ProjectFile.formerOnly([
        "/work/a/.pulse.json",
        "/work/a/.pulse-cli.json",
        "/work/b/.pulse-cli.json",
        "/work/c/other.json",
      ]),
    ).toEqual(["/work/b/.pulse-cli.json"])
  })
})
