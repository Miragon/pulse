import type { OrcaWorkerApi, PanelCaller } from "orca/worker"

type Handler = (input: unknown, context: { panel: PanelCaller; signal: AbortSignal }) => unknown

export interface Posted {
  readonly event: string
  readonly payload: unknown
  readonly panel: string | undefined
}

export class FakeOrca {
  readonly handlers = new Map<string, Handler>()
  readonly posted: Posted[] = []
  readonly logs: string[] = []
  readonly hostCalls: { readonly method: string; readonly params: unknown }[] = []
  readonly settings = new Map<string, unknown>()
  readonly storage = new Map<string, unknown>()
  readonly secrets = new Map<string, string>()
  hostAnswers: Readonly<Record<string, unknown>> = {}

  api(): OrcaWorkerApi {
    const api = {
      commands: { register: () => ({ dispose: () => undefined }) },
      events: { on: () => ({ dispose: () => undefined }) },
      hooks: { on: () => ({ dispose: () => undefined }) },
      panels: {
        handle: (name: string, handler: unknown) => {
          this.handlers.set(name, handler as Handler)
          return { dispose: () => undefined }
        },
        post: (event: string, payload: unknown, options?: { readonly panel?: string }) => {
          this.posted.push({ event, payload, panel: options?.panel })
        },
      },
      host: {
        call: (method: string, params?: unknown) => {
          this.hostCalls.push({ method, params })
          return Promise.resolve(this.hostAnswers[method] ?? null)
        },
      },
      settings: {
        get: (key: string) => Promise.resolve(this.settings.get(key)),
        set: (key: string, value: unknown) => {
          this.settings.set(key, value)
          return Promise.resolve()
        },
        onDidChange: () => ({ dispose: () => undefined }),
      },
      storage: {
        get: (key: string) => Promise.resolve(this.storage.get(key) ?? null),
        set: (key: string, value: unknown) => {
          this.storage.set(key, value)
          return Promise.resolve()
        },
      },
      secrets: {
        get: (key: string) => Promise.resolve(this.secrets.get(key) ?? null),
        set: (key: string, value: string) => {
          this.secrets.set(key, value)
          return Promise.resolve()
        },
        delete: (key: string) => {
          this.secrets.delete(key)
          return Promise.resolve()
        },
      },
      log: (message: string) => {
        this.logs.push(message)
      },
    }
    return api as unknown as OrcaWorkerApi
  }

  request(
    name: string,
    input: unknown,
    panel: PanelCaller,
    signal = new AbortController().signal,
  ): unknown {
    const handler = this.handlers.get(name)
    if (handler === undefined) {
      throw new Error(`no handler ${name}`)
    }
    return handler(input, { panel, signal })
  }
}

export const PULSE_PANEL: PanelCaller = {
  id: "panel-1",
  surface: "panel",
  contributionId: "engines",
}
export const EDITOR_FRAME: PanelCaller = {
  id: "frame-1",
  surface: "editor",
  contributionId: "pulse-view",
}
