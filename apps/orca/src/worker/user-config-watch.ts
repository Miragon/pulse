import { watch, type FSWatcher } from "node:fs"
import type { UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"

type Watch = (folder: string, listener: (event: string, name: string | null) => void) => FSWatcher

export class UserConfigWatch {
  private watcher: FSWatcher | undefined

  constructor(
    private readonly changed: () => void,
    private readonly watchFolder: Watch = watch,
  ) {}

  arm(location: UserConfigLocation): void {
    this.close()
    if (location.isRelative()) {
      return
    }
    const names = [location.fileName(), location.folderName()]
    this.watcher =
      this.watching(location.folder(), names, () => {
        this.changed()
      }) ?? this.parentWatch(location)
  }

  close(): void {
    this.watcher?.close()
    this.watcher = undefined
  }

  private parentWatch(location: UserConfigLocation): FSWatcher | undefined {
    if (location.parentFolder() === location.folder()) {
      return undefined
    }
    return this.watching(location.parentFolder(), [location.folderName()], () => {
      this.arm(location)
      this.changed()
    })
  }

  private watching(
    folder: string,
    names: readonly string[],
    then: () => void,
  ): FSWatcher | undefined {
    try {
      const watcher = this.watchFolder(folder, (_event, name) => {
        if (name === null || names.includes(name)) {
          then()
        }
      })
      watcher.once("error", () => {
        watcher.close()
      })
      return watcher
    } catch {
      return undefined
    }
  }
}
