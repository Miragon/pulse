import { EventEmitter } from "node:events"
import type { FSWatcher } from "node:fs"
import { describe, expect, test, vi } from "vitest"
import { UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"
import { UserConfigWatch } from "../src/worker/user-config-watch.js"

type Listener = (event: string, name: string | null) => void

const HOME = { XDG_CONFIG_HOME: "/home/me/.config" }
const FOLDER = "/home/me/.config/pulse-cli"
const PARENT = "/home/me/.config"

class FakeFolders {
  readonly existing = new Set<string>()
  readonly listeners = new Map<string, Listener>()
  readonly watchers = new Map<string, EventEmitter>()
  readonly closed: string[] = []

  readonly watch = (folder: string, listener: Listener): FSWatcher => {
    if (!this.existing.has(folder)) {
      throw Object.assign(new Error(`ENOENT: ${folder}`), { code: "ENOENT" })
    }
    const watcher = Object.assign(new EventEmitter(), {
      close: () => {
        this.closed.push(folder)
        this.listeners.delete(folder)
      },
    })
    this.listeners.set(folder, listener)
    this.watchers.set(folder, watcher)
    return watcher as unknown as FSWatcher
  }

  fire(folder: string, name: string | null): void {
    this.listeners.get(folder)?.("rename", name)
  }

  watched(): string[] {
    return [...this.listeners.keys()]
  }
}

function armed(env: Record<string, string> = HOME, ...existing: string[]) {
  const folders = new FakeFolders()
  for (const folder of existing) {
    folders.existing.add(folder)
  }
  const changed = vi.fn()
  const watch = new UserConfigWatch(changed, folders.watch)
  watch.arm(new UserConfigLocation(env, "/home/me", "linux"))
  return { folders, changed, watch }
}

describe("the watch on the CLI's user config", () => {
  test("watches its folder and reacts to the file, the folder itself and an unnamed change", () => {
    const { folders, changed } = armed(HOME, FOLDER, PARENT)

    folders.fire(FOLDER, "other.json")
    expect(changed).not.toHaveBeenCalled()

    folders.fire(FOLDER, "config.json")
    folders.fire(FOLDER, "pulse-cli")
    folders.fire(FOLDER, null)

    expect(folders.watched()).toEqual([FOLDER])
    expect(changed).toHaveBeenCalledTimes(3)
  })

  test("watches the folder above while its folder is missing, and moves into it when it appears", () => {
    const { folders, changed } = armed(HOME, PARENT)

    folders.fire(PARENT, "other-tool")
    expect(changed).not.toHaveBeenCalled()
    expect(folders.watched()).toEqual([PARENT])

    folders.existing.add(FOLDER)
    folders.fire(PARENT, "pulse-cli")

    expect(changed).toHaveBeenCalledOnce()
    expect(folders.closed).toEqual([PARENT])
    expect(folders.watched()).toEqual([FOLDER])
  })

  test("watches nothing for a relative path, nor when the folder above is missing too", () => {
    expect(armed({ PULSE_CLI_CONFIG: "ci.json" }, FOLDER, PARENT).folders.watched()).toEqual([])
    expect(armed(HOME).folders.watched()).toEqual([])
    expect(armed({ PULSE_CLI_CONFIG: "/config.json" }).folders.watched()).toEqual([])
  })

  test("stops a watcher that fails and every watcher when it closes", () => {
    const { folders, watch } = armed(HOME, FOLDER, PARENT)

    folders.watchers.get(FOLDER)?.emit("error", new Error("EPERM"))
    expect(folders.closed).toEqual([FOLDER])

    watch.arm(new UserConfigLocation(HOME, "/home/me", "linux"))
    watch.close()
    watch.close()

    expect(folders.closed).toEqual([FOLDER, FOLDER, FOLDER])
    expect(folders.watched()).toEqual([])
  })
})
