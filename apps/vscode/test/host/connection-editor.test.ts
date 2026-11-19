import type { Connection } from "@miragon/pulse-runtime-view/host-kit"
import { LOCAL_TARGET } from "./support/local-target.js"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ConnectionEditor } from "../../src/host/commands/connection-editor.js"
import type { OpenTargetsFileCommand } from "../../src/host/commands/open-targets-file-command.js"
import type { SetCredentialsCommand } from "../../src/host/commands/set-credentials-command.js"

const fake = vi.hoisted(() => ({
  offered: [] as string[],
  pick: 1,
}))

vi.mock("vscode", () => ({
  window: {
    showQuickPick: (items: readonly { label: string }[]) => {
      fake.offered = items.map((item) => item.label)
      return Promise.resolve(items[fake.pick])
    },
  },
}))

const OWN = "/home/dev/.config/pulse-cli/config.json"
const PROJECT = "/work/.pulse.json"

function connectionFrom(source: Connection["target"]["source"]): Connection {
  return { target: { ...LOCAL_TARGET, name: "dev", source } } as unknown as Connection
}

function editor() {
  const calls: unknown[] = []
  const setCredentials = {
    run: (argument: unknown) => {
      calls.push(["credentials", argument])
      return Promise.resolve()
    },
  } as unknown as SetCredentialsCommand
  const openTargetsFile = {
    run: (path: unknown) => {
      calls.push(["file", path])
      return Promise.resolve()
    },
  } as unknown as OpenTargetsFileCommand
  return { calls, editor: new ConnectionEditor(setCredentials, openTargetsFile) }
}

beforeEach(() => {
  fake.offered = []
  fake.pick = 1
})

describe("editing a connection", () => {
  test.each([
    [{ kind: "file", path: PROJECT } as const, "Open .pulse.json", PROJECT],
    [{ kind: "user-config", path: OWN } as const, "Open your CLI config", OWN],
    [{ kind: "default" } as const, "Configure Engines…", undefined],
  ])("opens the file its profile comes from: %o", async (source, label, path) => {
    const { calls, editor: edit } = editor()

    await edit.edit(connectionFrom(source))

    expect(fake.offered).toEqual(["Set credentials for dev…", label])
    expect(calls).toEqual([["file", path]])
  })

  test("sets the credentials of its engine", async () => {
    fake.pick = 0
    const { calls, editor: edit } = editor()
    const connection = connectionFrom({ kind: "file", path: PROJECT })

    await edit.edit(connection)

    expect(calls).toEqual([["credentials", { connection }]])
  })
})
