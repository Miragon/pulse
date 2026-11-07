export interface OrcaElement {
  readonly $$typeof: symbol
}
export type OrcaNode =
  OrcaElement | string | number | boolean | null | undefined | readonly OrcaNode[]
export type OrcaComponent<P> = (props: P) => OrcaNode
export interface ReadonlyAtom<T> {
  readonly __orcaAtom: T
}
export interface Atom<T> extends ReadonlyAtom<T> {
  readonly __orcaWritable: true
}
export interface Disposable {
  dispose(): void
}
export interface PanelContext {
  subscriptions: Disposable[]
  signal: AbortSignal
}

export type IconName =
  "activity" | "database" | "error" | "warning" | "layers" | "refresh" | "settings" | "plug"
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger"
type Gap = "none" | "xs" | "sm" | "md" | "lg"
type Press = () => unknown
interface WithChildren {
  children?: unknown
}
interface Leaf {
  children?: never
}

export interface TreeItem {
  key: string
  label: string
  description?: string
  icon?: IconName
  disabled?: boolean
  children?: readonly TreeItem[]
}

export const Stack: OrcaComponent<WithChildren & { gap?: Gap }>
export const Text: OrcaComponent<
  WithChildren & { tone?: Tone; muted?: boolean; size?: "xs" | "sm" | "md" }
>
export const Button: OrcaComponent<
  WithChildren & { variant?: "solid" | "outline" | "ghost"; disabled?: boolean; onPress?: Press }
>
export const IconButton: OrcaComponent<Leaf & { icon: IconName; label: string; onPress?: Press }>
export const Input: OrcaComponent<
  Leaf & {
    label: string
    value?: string
    placeholder?: string
    type?: "text" | "password"
    onChange?: (value: string) => void
  }
>
export const Toolbar: OrcaComponent<WithChildren & { label: string; gap?: Gap }>
export const Callout: OrcaComponent<WithChildren & { tone?: Tone; title?: string; icon?: IconName }>
export const EmptyState: OrcaComponent<
  WithChildren & { title: string; description?: string; icon?: IconName }
>
export const Spinner: OrcaComponent<Leaf & { label?: string }>
export const Tree: OrcaComponent<
  Leaf & {
    label: string
    items: readonly TreeItem[]
    expanded?: readonly string[]
    onToggle?: (item: { key: string; expanded: boolean }) => void
    onSelect?: (item: { key: string }) => void
    onAction?: (item: { key: string }) => void
  }
>
export const Fragment: OrcaComponent<WithChildren>

export function atom<T>(initial: T): Atom<T>
export function read<T>(atom: ReadonlyAtom<T>): T
export function set<T>(atom: Atom<T>, value: T): void

export interface PluginRequests {
  readonly __none?: never
}
export interface PluginPanelEvents {
  readonly __none?: never
}
type InputOf<K extends keyof PluginRequests> = PluginRequests[K] extends { input: infer I }
  ? I
  : undefined
type OutputOf<K extends keyof PluginRequests> = PluginRequests[K] extends { output: infer O }
  ? O
  : null
export const plugin: {
  request<K extends keyof PluginRequests>(name: K, input?: InputOf<K>): Promise<OutputOf<K>>
  on<K extends keyof PluginPanelEvents>(
    event: K,
    handler: (payload: PluginPanelEvents[K]) => void,
  ): Disposable
}
