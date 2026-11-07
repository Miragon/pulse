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
  visible: ReadonlyAtom<boolean>
  panel: { id: string }
}

export type IconName =
  | "activity"
  | "add"
  | "check"
  | "close"
  | "database"
  | "edit"
  | "error"
  | "file"
  | "file-text"
  | "gauge"
  | "layers"
  | "open-external"
  | "plug"
  | "refresh"
  | "search"
  | "settings"
  | "star"
  | "warning"
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger"
type Gap = "none" | "xs" | "sm" | "md" | "lg"
type Size = "xs" | "sm" | "md"
type Variant = "solid" | "outline" | "ghost"
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
export const Row: OrcaComponent<
  WithChildren & { gap?: Gap; justify?: "start" | "center" | "end" | "between"; wrap?: boolean }
>
export const Text: OrcaComponent<
  WithChildren & {
    tone?: Tone
    muted?: boolean
    size?: Size
    weight?: "regular" | "medium" | "semibold"
  }
>
export const Button: OrcaComponent<
  WithChildren & {
    variant?: Variant
    tone?: Tone
    size?: Size
    icon?: IconName
    disabled?: boolean
    onPress?: Press
  }
>
export const IconButton: OrcaComponent<
  Leaf & { icon: IconName; label: string; variant?: Variant; disabled?: boolean; onPress?: Press }
>
export const Input: OrcaComponent<
  Leaf & {
    label: string
    labelHidden?: boolean
    value?: string
    placeholder?: string
    type?: "text" | "search" | "password"
    invalid?: boolean
    onChange?: (value: string) => void
    onSubmit?: (value: string) => void
  }
>
export const Select: OrcaComponent<
  Leaf & {
    label: string
    labelHidden?: boolean
    value?: string
    options: readonly { value: string; label: string }[]
    onChange?: (value: string) => void
  }
>
export const Toolbar: OrcaComponent<WithChildren & { label: string; gap?: Gap }>
export const Callout: OrcaComponent<WithChildren & { tone?: Tone; title?: string; icon?: IconName }>
export const Collapsible: OrcaComponent<
  WithChildren & { title: string; description?: string; defaultOpen?: boolean }
>
export const List: OrcaComponent<WithChildren & { label?: string }>
export const ListItem: OrcaComponent<
  WithChildren & { title?: string; description?: string; icon?: IconName; onPress?: Press }
>
export const EmptyState: OrcaComponent<
  WithChildren & { title: string; description?: string; icon?: IconName }
>
export const Spinner: OrcaComponent<Leaf & { label?: string }>
export const Tree: OrcaComponent<
  Leaf & {
    label: string
    items: readonly TreeItem[]
    selected?: string
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
  request<K extends keyof PluginRequests>(
    name: K,
    input?: InputOf<K>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<OutputOf<K>>
  on<K extends keyof PluginPanelEvents>(
    event: K,
    handler: (payload: PluginPanelEvents[K]) => void,
  ): Disposable
}
