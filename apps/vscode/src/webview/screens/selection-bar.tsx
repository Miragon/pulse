import type { SelectionView } from '../../core/protocol/index.js';
import { useHost } from '../host/host-context.js';

function SelectionCount({ selection }: { readonly selection: SelectionView }) {
  const text = selection.allMatching
    ? `All ${selection.count} ${selection.eligible} selected`
    : `${selection.count} selected`;
  return (
    <span class="selection-bar__count" aria-live="polite">
      {text}
    </span>
  );
}

function SelectionOffers({ selection }: { readonly selection: SelectionView }) {
  const host = useHost();
  return (
    <>
      {selection.offers.map((offer) => (
        <button
          key={offer.action}
          type="button"
          class="button button--secondary button--compact"
          onClick={() => {
            host.post({ type: 'startBulk', action: offer.action });
          }}
        >
          {offer.label}
        </button>
      ))}
      {selection.migration !== undefined && (
        <button
          type="button"
          class="button button--secondary button--compact"
          onClick={() => {
            host.post({ type: 'openMigration' });
          }}
        >
          {selection.migration}
        </button>
      )}
    </>
  );
}

export function SelectionBar({ selection }: { readonly selection: SelectionView }) {
  const host = useHost();
  return (
    <div class="selection-bar" role="group" aria-label="Selected instances">
      <SelectionCount selection={selection} />
      {selection.matching !== undefined && (
        <button
          type="button"
          class="button button--ghost button--compact"
          onClick={() => {
            host.post({ type: 'selectMatching' });
          }}
        >
          Select all {selection.matching} {selection.eligible}
        </button>
      )}
      {selection.overCap !== undefined && (
        <span class="muted selection-bar__note">
          {selection.overCap} match · narrow the filter to {selection.cap} or fewer
        </span>
      )}
      <span class="selection-bar__spacer" />
      {selection.blockedBy !== undefined ? (
        <span class="muted selection-bar__note">{selection.blockedBy}</span>
      ) : (
        selection.count > 0 && <SelectionOffers selection={selection} />
      )}
      <button
        type="button"
        class="button button--ghost button--compact"
        onClick={() => {
          host.post({ type: 'clearSelection' });
        }}
      >
        Clear
      </button>
    </div>
  );
}
