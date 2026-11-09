import type { OrcaWorkerApi, PanelCaller } from "orca/worker"

type Handler = (input: unknown, context: { panel: PanelCaller; signal: AbortSignal }) => unknown
type Command = (args: unknown, context: { signal: AbortSignal }) => unknown
type EventListener = (payload: unknown) => unknown
type Hook = (event: unknown, next: (event?: unknown) => unknown) => unknown
type SettingListener = (change: { readonly key: string }) => void

export interface Posted {
  readonly event: string
  readonly payload: unknown
  readonly panel: string | undefined
}

export class FakeOrca {
  readonly handlers = new Map<string, Handler>()
  readonly commands = new Map<string, Command>()
  readonly events = new Map<string, EventListener>()
  readonly hooks = new Map<string, Hook>()
  readonly settingListeners: SettingListener[] = []
  readonly posted: Posted[] = []
  readonly logs: string[] = []
  readonly hostCalls: { readonly method: string; readonly params: unknown }[] = []
  readonly failingHostCalls = new Set<string>()
  readonly settings = new Map<string, unknown>()
  readonly storage = new Map<string, unknown>()
  readonly secrets = new Map<string, string>()
  hostAnswers: Readonly<Record<string, unknown>> = {}

  api(): OrcaWorkerApi {
    const api = {
      commands: {
        register: (id: string, handler: Command) => {
          this.commands.set(id, handler)
          return FakeOrca.disposable()
        },
      },
      events: {
        on: (event: string, listener: EventListener) => {
          this.events.set(event, listener)
          return FakeOrca.disposable()
        },
      },
      hooks: {
        on: (name: string, hook: Hook) => {
          this.hooks.set(name, hook)
          return FakeOrca.disposable()
        },
      },
      panels: {
        handle: (name: string, handler: unknown) => {
          this.handlers.set(name, handler as Handler)
          return FakeOrca.disposable()
        },
        post: (event: string, payload: unknown, options?: { readonly panel?: string }) => {
          this.posted.push({ event, payload, panel: options?.panel })
        },
      },
      host: { call: (method: string, params?: unknown) => this.hostCall(method, params) },
      settings: {
        get: (key: string) => Promise.resolve(this.settings.get(key)),
        set: (key: string, value: unknown) => {
          this.settings.set(key, value)
          return Promise.resolve()
        },
        onDidChange: (listener: SettingListener) => {
          this.settingListeners.push(listener)
          return FakeOrca.disposable()
        },
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

  run(command: string): Promise<unknown> {
    const handler = this.commands.get(command)
    if (handler === undefined) {
      throw new Error(`no command ${command}`)
    }
    return Promise.resolve(handler(undefined, { signal: new AbortController().signal }))
  }

  emit(event: string, payload: unknown): unknown {
    return this.events.get(event)?.(payload)
  }

  hook(name: string, event: unknown): unknown {
    const hook = this.hooks.get(name)
    if (hook === undefined) {
      throw new Error(`no hook ${name}`)
    }
    return hook(event, (passed) => ({ continued: passed }))
  }

  changeSetting(key: string, value: unknown): void {
    this.settings.set(key, value)
    for (const listener of this.settingListeners) {
      listener({ key })
    }
  }

  postsOf(event: string): unknown[] {
    return this.posted.filter((post) => post.event === event).map((post) => post.payload)
  }

  callsOf(method: string): unknown[] {
    return this.hostCalls.filter((call) => call.method === method).map((call) => call.params)
  }

  private hostCall(method: string, params: unknown): Promise<unknown> {
    this.hostCalls.push({ method, params })
    if (this.failingHostCalls.has(method)) {
      return Promise.reject(new Error(`${method} failed`))
    }
    return Promise.resolve(this.hostAnswers[method] ?? null)
  }

  private static disposable() {
    return { dispose: () => undefined }
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
