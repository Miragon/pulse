import { Icon } from "@miragon/pulse-ui"
import { SplinePointerIcon, UnlinkIcon } from "lucide-react"
import type { MappingDecoration, MappingHandle } from "./decorations.js"

export interface MappingHandlesProps {
  readonly handle: MappingHandle
  readonly mapping: MappingDecoration
}

export function MappingHandles({ handle, mapping }: MappingHandlesProps) {
  const { elementId, label, mapped } = handle
  const shown = mapping.shown === elementId
  const mapLabel = `Map ${label} to an element of v${String(mapping.targetVersion)}`
  const unmapLabel = `Remove the mapping of ${label}`
  return (
    <span
      className="mapping-handles"
      data-part="mapping-handle"
      data-shown={shown ? "" : undefined}
    >
      <button
        type="button"
        className="map-handle"
        data-kind="map"
        data-map-from={elementId}
        tabIndex={shown ? 0 : -1}
        aria-label={mapLabel}
        title={`${mapLabel}: drag it there, or click here and then on it`}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          mapping.onStart(elementId, { x: event.clientX, y: event.clientY, pointer: true })
        }}
        onClick={(event) => {
          event.stopPropagation()
          if (event.detail === 0) {
            mapping.onStart(elementId, { x: 0, y: 0, pointer: false })
          }
        }}
      >
        <Icon icon={SplinePointerIcon} dense />
      </button>
      {mapped && (
        <button
          type="button"
          className="map-handle"
          data-kind="unmap"
          data-map-from={elementId}
          tabIndex={shown ? 0 : -1}
          aria-label={unmapLabel}
          title={unmapLabel}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            mapping.onUnmap(elementId)
          }}
        >
          <Icon icon={UnlinkIcon} dense />
        </button>
      )}
    </span>
  )
}
