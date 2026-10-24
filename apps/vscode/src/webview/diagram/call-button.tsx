import type { CallLink } from '../../core/protocol/index.js';
const DRILLDOWN_ARROW = 'M4.82 3.51 10.5 9.19V4H12v8H4v-1.5h5.69L3.76 4.57a.75.75 0 0 1 1.06-1.06Z';

export interface CallButtonProps {
  readonly call: CallLink;
  readonly onOpen: (elementId: string, toSide: boolean) => void;
}

export function CallButton({ call, onOpen }: CallButtonProps) {
  return (
    <button
      type="button"
      class={`bjs-drilldown call-button${call.missing === true ? ' call-button--missing' : ''}`}
      data-call-for={call.elementId}
      aria-label={call.label}
      title={call.label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(call.elementId, event.metaKey || event.ctrlKey);
      }}
    >
      <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path fill-rule="evenodd" d={DRILLDOWN_ARROW} />
      </svg>
    </button>
  );
}
