import { Button, Icon, TONE_ICON } from "@miragon/pulse-ui"
import { CircleXIcon } from "lucide-react"
import { useEffect, useRef, type RefObject } from "react"
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
      <span
        className="flex min-w-0 items-center gap-1.5 @max-[760px]/list:basis-full"
        data-part="migration-refusal"
        title={offer.reason}
      >
        <Icon icon={CircleXIcon} className={TONE_ICON.danger} />
        <span className="min-w-0 truncate @max-[760px]/list:whitespace-normal">{offer.reason}</span>
      </span>
      {offer.leaveOut !== undefined && (
        <Button type="button" variant="outline" size="sm" onClick={onLeaveOut}>
          {offer.leaveOut}
        </Button>
      )}
    </>
  )
}

interface OfferProps {
  readonly offer: MigrateOffer
  readonly migrate: RefObject<HTMLButtonElement | null>
  readonly onLeaveOut: () => void
}

function Offer({ offer, migrate, onLeaveOut }: OfferProps) {
  const host = useHost()
  switch (offer.status) {
    case "ready":
      return (
        <Button
          ref={migrate}
          type="button"
          size="sm"
          onClick={() => {
            host.post({ type: "startMigration" })
          }}
        >
          {offer.label}
        </Button>
      )
    case "checking":
      return <span className="text-muted-foreground">Checking the plan…</span>
    case "pickTarget":
      return <span className="text-muted-foreground">{offer.reason}</span>
    case "refused":
      return <Refusal offer={offer} onLeaveOut={onLeaveOut} />
  }
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
    <div
      className="bg-card border-border min-h-entry px-gutter flex flex-none items-center gap-2 border-t @max-[760px]/list:flex-wrap @max-[760px]/list:gap-y-1 @max-[760px]/list:py-1"
      role="group"
      aria-label="Migration"
    >
      <span className="text-muted-foreground whitespace-nowrap" data-part="migration-summary">
        {summary}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <span className="flex-1" />
      <Offer
        offer={offer}
        migrate={migrate}
        onLeaveOut={() => {
          focusWhenReady.current = true
          host.post({ type: "leaveOutUnmapped" })
        }}
      />
    </div>
  )
}
