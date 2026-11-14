import { Button } from "@miragon/pulse-ui"
import type { SelectionView } from "../../core/protocol/index.js"
import { CountLabels } from "../format/count-labels.js"
import { useHost } from "../host/host-context.js"

const NOTE =
  "text-muted-foreground min-w-0 truncate @max-[47.5rem]/list:order-1 @max-[47.5rem]/list:basis-full"

function SelectionCount({ selection }: { readonly selection: SelectionView }) {
  const text = selection.allMatching
    ? `All ${CountLabels.exact(selection.count)} ${selection.eligible} selected`
    : `${CountLabels.exact(selection.count)} selected`
  return (
    <span
      className="font-semibold whitespace-nowrap tabular-nums"
      data-part="selection-count"
      aria-live="polite"
    >
      {text}
    </span>
  )
}

function SelectionOffers({ selection }: { readonly selection: SelectionView }) {
  const host = useHost()
  return (
    <>
      {selection.offers.map((offer) => (
        <Button
          key={offer.action}
          type="button"
          variant="outline"
          size="xs"
          onClick={() => {
            host.post({ type: "startBulk", action: offer.action })
          }}
        >
          {offer.label}
        </Button>
      ))}
      {selection.migration !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => {
            host.post({ type: "openMigration" })
          }}
        >
          {selection.migration}
        </Button>
      )}
    </>
  )
}

export function SelectionBar({ selection }: { readonly selection: SelectionView }) {
  const host = useHost()
  return (
    <div
      className="border-border bg-info-surface text-dense px-gutter flex min-h-8 flex-none items-center gap-2 border-b @max-[47.5rem]/list:flex-wrap @max-[47.5rem]/list:gap-y-1 @max-[47.5rem]/list:py-1"
      role="group"
      aria-label="Selected instances"
    >
      <SelectionCount selection={selection} />
      {selection.matching !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => {
            host.post({ type: "selectMatching" })
          }}
        >
          Select all {selection.matching} {selection.eligible}
        </Button>
      )}
      {selection.overCap !== undefined && (
        <span className={NOTE}>
          {selection.overCap} match · narrow the filter to {selection.cap} or fewer
        </span>
      )}
      <span className="flex-1" />
      {selection.blockedBy !== undefined ? (
        <span className={NOTE}>{selection.blockedBy}</span>
      ) : (
        selection.count > 0 && <SelectionOffers selection={selection} />
      )}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => {
          host.post({ type: "clearSelection" })
        }}
      >
        Clear
      </Button>
    </div>
  )
}
