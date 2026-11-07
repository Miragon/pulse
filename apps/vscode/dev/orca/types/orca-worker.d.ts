import type { PluginPanelEvents, PluginRequests } from "orca"

type InputOf<K extends keyof PluginRequests> = PluginRequests[K] extends { input: infer I }
  ? I
  : undefined
type OutputOf<K extends keyof PluginRequests> = PluginRequests[K] extends { output: infer O }
  ? O
  : null

export interface Disposable {
  dispose(): void
}

export interface PanelCaller {
  readonly id: string
  readonly surface: "panel" | "editor"
  readonly contributionId: string
}

export interface FocusedContext {
  readonly branch: string
  readonly displayName: string
  readonly terminals: readonly { readonly id: string; readonly title?: string }[]
}

export interface PluginEvents {
  "workspace.changed": { readonly context: FocusedContext | null }
}

declare const hookContinue: unique symbol
export interface HookContinue {
  readonly [hookContinue]: true
}

export interface PluginHooks {
  "editor.save.before": {
    event: { workspaceId: string | null; path: string; languageId?: string; text: string }
    result: { deny: string }
  }
}

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface OrcaWorkerApi {
  readonly commands: {
    register(commandId: string, handler: (args: unknown) => unknown): Disposable
  }
  readonly events: {
    on<E extends keyof PluginEvents>(
      event: E,
      handler: (payload: PluginEvents[E]) => void | Promise<void>,
    ): Disposable
  }
  readonly hooks: {
    on<H extends keyof PluginHooks>(
      hook: H,
      handler: (
        event: PluginHooks[H]["event"],
        next: (event?: PluginHooks[H]["event"]) => HookContinue,
      ) => HookContinue | PluginHooks[H]["result"] | undefined,
    ): Disposable
  }
  readonly panels: {
    handle<K extends keyof PluginRequests>(
      name: K,
      handler: (
        input: InputOf<K>,
        context: { panel: PanelCaller; signal: AbortSignal },
      ) => OutputOf<K> | Promise<OutputOf<K>>,
    ): Disposable
    post<K extends keyof PluginPanelEvents>(
      event: K,
      payload: PluginPanelEvents[K],
      options?: { panel?: string },
    ): void
  }
  readonly host: {
    call(method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown>
  }
  readonly settings: {
    get(key: string): Promise<unknown>
    set(key: string, value: JsonValue): Promise<void>
    onDidChange(listener: (change: { key: string }) => void): Disposable
  }
  readonly storage: {
    get(key: string): Promise<JsonValue | null>
    set(key: string, value: JsonValue): Promise<void>
  }
  readonly secrets: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
  log(message: string): void
}
