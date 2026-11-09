import { useEffect, useRef } from "preact/hooks"
import type { MigrateOffer } from "../../core/protocol/index.js"
import { useHost } from "../host/host-context.js"

function Refusal({
  offer,
  onLeaveOut,
}: {
  readonly offer: Extract<MigrateOffer, { readonly status: "refused" }>
  readonly onLeaveOut: () => void
}) {
  return (
    <>
      <span class="migration-actions__refusal" title={offer.reason}>
        {offer.reason}
      </span>
      {offer.leaveOut !== undefined && (
        <button type="button" class="button button--secondary button--compact" onClick={onLeaveOut}>
          {offer.leaveOut}
        </button>
      )}
    </>
  )
}

export function MigrationActions({
  offer,
  summary,
}: {
  readonly offer: MigrateOffer
  readonly summary: string
}) {
  const host = useHost()
  const migrate = useRef<HTMLButtonElement>(null)
  const announcement =
    offer.status === "refused" ? offer.reason : offer.status === "ready" ? offer.label : ""
  const focusWhenReady = useRef(false)
  useEffect(() => {
    if (focusWhenReady.current && offer.status === "ready") {
      focusWhenReady.current = false
      migrate.current?.focus()
    }
  }, [offer.status])
  return (
    <div class="migration-actions" role="group" aria-label="Migration">
      <span class="migration-actions__summary">{summary}</span>
      <span class="visually-hidden" aria-live="polite">
        {announcement}
      </span>
      <span class="selection-bar__spacer" />
      {offer.status === "ready" && (
        <button
          ref={migrate}
          type="button"
          class="button button--primary button--compact"
          onClick={() => {
            host.post({ type: "startMigration" })
          }}
        >
          {offer.label}
        </button>
      )}
      {offer.status === "checking" && <span class="muted">Checking the plan…</span>}
      {offer.status === "pickTarget" && <span class="muted">{offer.reason}</span>}
      {offer.status === "refused" && (
        <Refusal
          offer={offer}
          onLeaveOut={() => {
            focusWhenReady.current = true
            host.post({ type: "leaveOutUnmapped" })
          }}
        />
      )}
    </div>
  )
}
