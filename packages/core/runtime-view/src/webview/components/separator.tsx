import type {
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
  Ref,
  SyntheticEvent,
} from "react"

type SeparatorKeys = Readonly<Record<string, (event: KeyboardEvent<HTMLDivElement>) => void>>

export interface SeparatorProps {
  readonly className: string
  readonly label: string
  readonly orientation: "horizontal" | "vertical"
  readonly value: number | undefined
  readonly min: number
  readonly max: number
  readonly valueText?: string | undefined
  readonly keys: SeparatorKeys
  readonly onDragStart: (event: PointerEvent<HTMLDivElement>) => void
  readonly onDrag: (event: PointerEvent<HTMLDivElement>) => void
  readonly onDragEnd: () => void
  readonly onDragCancel: () => void
  readonly onFocus?: (event: FocusEvent<HTMLDivElement>) => void
  readonly onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void
  readonly handle?: Ref<HTMLDivElement>
}

const DRAGGING = "data-dragging"

export function Separator(props: SeparatorProps) {
  const handleOf = (event: SyntheticEvent<HTMLDivElement>): HTMLElement => event.currentTarget
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const action = props.keys[event.key]
    if (event.key === "Escape" && handleOf(event).hasAttribute(DRAGGING)) {
      event.stopPropagation()
      handleOf(event).removeAttribute(DRAGGING)
      props.onDragCancel()
    } else if (action !== undefined) {
      event.preventDefault()
      action(event)
    }
  }
  return (
    <div
      ref={props.handle ?? null}
      className={props.className}
      role="separator"
      aria-orientation={props.orientation}
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-valuetext={props.valueText}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={props.onFocus}
      onDoubleClick={props.onDoubleClick}
      onPointerDown={(event) => {
        handleOf(event).setPointerCapture(event.pointerId)
        handleOf(event).setAttribute(DRAGGING, "")
        props.onDragStart(event)
      }}
      onPointerMove={(event) => {
        if (handleOf(event).hasAttribute(DRAGGING)) {
          props.onDrag(event)
        }
      }}
      onPointerUp={(event) => {
        if (handleOf(event).hasAttribute(DRAGGING)) {
          handleOf(event).removeAttribute(DRAGGING)
          props.onDragEnd()
        }
      }}
    />
  )
}
