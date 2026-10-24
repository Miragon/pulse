type SeparatorKeys = Readonly<Record<string, (event: KeyboardEvent) => void>>;

export interface SeparatorProps {
  readonly class: string;
  readonly label: string;
  readonly orientation: 'horizontal' | 'vertical';
  readonly value: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly valueText?: string | undefined;
  readonly keys: SeparatorKeys;
  readonly onDragStart: (event: PointerEvent) => void;
  readonly onDrag: (event: PointerEvent) => void;
  readonly onDragEnd: () => void;
  readonly onDragCancel: () => void;
  readonly onFocus?: (event: FocusEvent) => void;
  readonly onDoubleClick?: (event: MouseEvent) => void;
}

const DRAGGING = 'data-dragging';

export function Separator(props: SeparatorProps) {
  const handleOf = (event: Event): HTMLElement => event.currentTarget as HTMLElement;
  const onKeyDown = (event: KeyboardEvent): void => {
    const action = props.keys[event.key];
    if (event.key === 'Escape' && handleOf(event).hasAttribute(DRAGGING)) {
      event.stopPropagation();
      handleOf(event).removeAttribute(DRAGGING);
      props.onDragCancel();
    } else if (action !== undefined) {
      event.preventDefault();
      action(event);
    }
  };
  return (
    <div
      class={props.class}
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
      onDblClick={props.onDoubleClick}
      onPointerDown={(event) => {
        handleOf(event).setPointerCapture(event.pointerId);
        handleOf(event).setAttribute(DRAGGING, '');
        props.onDragStart(event);
      }}
      onPointerMove={(event) => {
        if (handleOf(event).hasAttribute(DRAGGING)) {
          props.onDrag(event);
        }
      }}
      onPointerUp={(event) => {
        if (handleOf(event).hasAttribute(DRAGGING)) {
          handleOf(event).removeAttribute(DRAGGING);
          props.onDragEnd();
        }
      }}
    />
  );
}
