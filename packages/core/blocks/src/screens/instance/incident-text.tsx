import {
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  WrapTextIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button, Icon, TEXT_BLOCK_FRAME, cn } from "@miragon/pulse-ui"
import type { IncidentTextKind } from "@miragon/pulse-screens"
import { useInstanceWords } from "../../messages/instance-words.js"
import type { InstanceSlots } from "../slots.js"

/** The line breaks `RootCauses` splits a text at, so a line's index is the contract's. */
const LINE_BREAK = /\r\n|[\n\r]/

/**
 * What a surface read of an incident's text: reading, failed, or read (the text, whether the
 * engine cut it off, and the index of the line its root cause stands on, as the contract's
 * `IncidentDetails.rootCauseLine` gives it by `RootCauses.lineOf`: the last "Caused by:" line,
 * none without one). Before the first read it hands in none.
 */
export type IncidentTextRead =
  | { readonly status: "reading" }
  | { readonly status: "failed" }
  | {
      readonly status: "read"
      readonly text: string
      readonly truncated: boolean
      readonly rootCauseLine?: number
    }

export interface IncidentTextProps {
  /** Which text the incident has: a stack trace, or the error message of a worker or the engine. */
  readonly kind: IncidentTextKind
  /**
   * Open from the start (the focus on an incident), else closed until the reader opens it. Open
   * from the start without a read, it asks for the text at once (`onRead`).
   */
  readonly defaultOpen?: boolean
  /** The read so far: none before the first. */
  readonly read?: IncidentTextRead
  /**
   * Asks the surface to read the text: once, when the text first shows open without a read (from
   * the start, or when the reader opens it), and again after a failed read on the reader's retry.
   */
  readonly onRead: () => void
  readonly slots: Pick<InstanceSlots, "onCopy">
}

function TextLines({
  text,
  rootCauseLine,
  wrap,
}: {
  readonly text: string
  readonly rootCauseLine: number | undefined
  readonly wrap: boolean
}) {
  const t = useInstanceWords()
  const lines = text.split(LINE_BREAK)
  return (
    <pre
      className={cn(
        "border-border bg-background text-dense max-h-80 w-full overflow-auto rounded-sm border px-3 py-2 font-mono",
        wrap ? "wrap-anywhere whitespace-pre-wrap" : "whitespace-pre",
        TEXT_BLOCK_FRAME,
      )}
      data-part="incident-text"
      tabIndex={0}
    >
      {lines.map((line, index) => (
        <span key={index} className="block">
          {index === rootCauseLine ? (
            <mark
              className="text-foreground bg-transparent font-semibold"
              data-part="root-cause-line"
            >
              {line}
              <span className="text-muted-foreground font-normal">{` ← ${t("text.rootCause")}`}</span>
            </mark>
          ) : (
            line
          )}
        </span>
      ))}
    </pre>
  )
}

function ReadText({ kind, read, onRead, slots }: Omit<IncidentTextProps, "defaultOpen">) {
  const t = useInstanceWords()
  const [wrap, setWrap] = useState(false)
  if (read === undefined || read.status === "reading") {
    return (
      <p className="text-muted-foreground inline-flex items-center gap-1.5" role="status">
        <Icon icon={LoaderCircleIcon} className="motion-safe:animate-spin" />
        {t("text.reading")}
      </p>
    )
  }
  if (read.status === "failed") {
    return (
      <p className="flex flex-wrap items-center gap-2" role="alert">
        {t("text.failed")}
        <Button type="button" variant="outline" size="sm" onClick={onRead}>
          <Icon icon={RotateCcwIcon} />
          {t("text.retry")}
        </Button>
      </p>
    )
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-small text-muted-foreground">{t(`text.label.${kind}`)}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t(`text.copyName.${kind}`)}
          onClick={() => {
            slots.onCopy({ text: read.text, label: t(`text.copied.${kind}`) })
          }}
        >
          <Icon icon={CopyIcon} />
          {t("text.copy")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={wrap}
          onClick={() => {
            setWrap(!wrap)
          }}
        >
          <Icon icon={WrapTextIcon} />
          {t("text.wrap")}
        </Button>
      </div>
      <TextLines text={read.text} rootCauseLine={read.rootCauseLine} wrap={wrap} />
      {read.truncated && <p className="text-muted-foreground">{t("text.cutOff")}</p>}
    </>
  )
}

/**
 * An incident's text in place, read only when it shows open (`onRead`): a stack trace, or an error
 * message where the engine keeps no stack trace. It marks the line its root cause stands on (the
 * read's `rootCauseLine`), copies the whole text and wraps its lines on request; a long text
 * scrolls in its own box, and a text the engine cut off says so. A failed read says so and reads
 * again on request.
 */
export function IncidentText({ defaultOpen = false, ...props }: IncidentTextProps) {
  const t = useInstanceWords()
  const [open, setOpen] = useState(defaultOpen)
  const asked = useRef(false)
  const { kind, read, onRead } = props
  useEffect(() => {
    if (open && read === undefined && !asked.current) {
      asked.current = true
      onRead()
    }
  }, [open, read, onRead])
  const toggle = (): void => {
    setOpen(!open)
  }
  return (
    <div
      className="flex w-full basis-full flex-col items-start gap-2"
      data-part="incident-text-region"
    >
      <Button type="button" variant="outline" aria-expanded={open} onClick={toggle}>
        <Icon icon={open ? ChevronDownIcon : ChevronRightIcon} />
        {t(open ? `text.hide.${kind}` : `text.show.${kind}`)}
      </Button>
      {open && <ReadText {...props} />}
    </div>
  )
}
