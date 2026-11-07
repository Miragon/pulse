import type { PluginPanelEvents, PluginRequests } from "orca"

type InputOf<K extends keyof PluginRequests> = PluginRequests[K] extends { input: infer I }
  ? I
  : undefined
type OutputOf<K extends keyof PluginRequests> = PluginRequests[K] extends { output: infer O }
  ? O
  : null

export interface PanelCaller {
  readonly id: string
  readonly surface: "panel" | "editor"
  readonly contributionId: string
}

export interface OrcaWorkerApi {
  readonly panels: {
    handle<K extends keyof PluginRequests>(
      name: K,
      handler: (
        input: InputOf<K>,
        context: { panel: PanelCaller; signal: AbortSignal },
      ) => OutputOf<K> | Promise<OutputOf<K>>,
    ): { dispose(): void }
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
    set(key: string, value: string): Promise<void>
  }
  readonly secrets: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
  log(message: string): void
}
