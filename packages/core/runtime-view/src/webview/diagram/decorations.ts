import type {
  CallLink,
  ElementBadge,
  ElementMarker,
  InstanceScope,
} from "../../core/protocol/index.js"
import type { ElementCode } from "./code-button.js"
import type { ElementRegistryLike } from "./diagram-elements.js"
import type { MoveEntryDecoration } from "./move-entry.js"

export type BadgeFilter = (elementId: string, scope?: InstanceScope) => void

export interface MoveDecoration {
  readonly from: string
  readonly to?: string
  readonly targets: readonly string[]
  readonly refused: readonly string[]
}

export interface DrawStart {
  readonly x: number
  readonly y: number
  readonly pointer: boolean
}

export interface MappingHandle {
  readonly elementId: string
  readonly label: string
  readonly mapped: boolean
}

export interface MappingDecoration {
  readonly handles: readonly MappingHandle[]
  readonly targetVersion: number
  readonly shown?: string | undefined
  readonly onStart: (elementId: string, start: DrawStart) => void
  readonly onUnmap: (elementId: string) => void
}

export interface Decorations {
  readonly badges: readonly ElementBadge[]
  readonly markers: readonly ElementMarker[]
  readonly calls: readonly CallLink[]
  readonly stale: boolean
  readonly focusElementId?: string | undefined
  readonly codes?: readonly ElementCode[]
  readonly move?: MoveDecoration | undefined
  readonly moveEntry?: MoveEntryDecoration | undefined
  readonly candidates?: readonly string[]
  readonly unmapped?: readonly string[]
  readonly mapping?: MappingDecoration | undefined
  readonly counterparts?: readonly string[]
  readonly dropTarget?: string | undefined
}

export interface OverlaysLike {
  add(element: string, type: string, overlay: object): string
  remove(filter: { readonly type: string }): void
}

export interface CanvasMarkersLike {
  addMarker(element: string, marker: string): void
  removeMarker(element: string, marker: string): void
}

export interface SelectionLike {
  select(element: object | null): void
}

export interface DecorationServices {
  readonly overlays: OverlaysLike
  readonly selection: SelectionLike
  readonly canvas: CanvasMarkersLike
  readonly registry: ElementRegistryLike
  readonly names: ReadonlyMap<string, string>
}
