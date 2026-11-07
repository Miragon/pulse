import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import type { ViewHandle, ViewRequest } from "../protocol.js"

const FOLDER = join(".pulse", "views")
const SHORT_ID = 8

export class ViewHandles {
  static async write(root: string, request: ViewRequest): Promise<string> {
    const folder = join(root, FOLDER, ViewHandles.safe(request.engine))
    await mkdir(folder, { recursive: true })
    await writeFile(join(root, FOLDER, ".gitignore"), "*\n")
    const file = join(folder, ViewHandles.fileName(request))
    const handle: ViewHandle = { pulse: 1, ...request }
    await writeFile(file, `${JSON.stringify(handle, null, 2)}\n`)
    return file
  }

  static async writeText(
    root: string,
    engine: string,
    name: string,
    text: string,
  ): Promise<string> {
    const folder = join(root, FOLDER, ViewHandles.safe(engine))
    await mkdir(folder, { recursive: true })
    await writeFile(join(root, FOLDER, ".gitignore"), "*\n")
    const file = join(folder, ViewHandles.safe(name))
    await writeFile(file, text)
    return file
  }

  static keyOf(request: ViewRequest): string {
    return `${request.engine}/${ViewHandles.fileName(request)}`
  }

  static parse(text: string): ViewHandle | undefined {
    try {
      const value = JSON.parse(text) as Partial<ViewHandle>
      return value.pulse === 1 && typeof value.engine === "string" && typeof value.view === "string"
        ? (value as ViewHandle)
        : undefined
    } catch {
      return undefined
    }
  }

  static fileName(request: ViewRequest): string {
    return `${ViewHandles.safe(ViewHandles.baseName(request))}.pulse-view`
  }

  private static baseName(request: ViewRequest): string {
    switch (request.view) {
      case "engine":
        return `${request.engine} processes`
      case "definition":
        return request.definitionId === undefined && request.filter === undefined
          ? request.bpmnProcessId
          : `${request.bpmnProcessId} ${ViewHandles.hash(request)}`
      case "instance":
        return request.instanceId.slice(0, SHORT_ID)
      case "migration":
        return `migrate ${request.bpmnProcessId}`
      case "model":
        return `${basename(request.modelPath)} runtime`
    }
  }

  private static hash(request: ViewRequest): string {
    return createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 6)
  }

  private static safe(name: string): string {
    return name.replace(/[^\w .-]/g, "_")
  }
}
