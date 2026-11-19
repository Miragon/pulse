import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { MoveOption, MoveTarget } from "../../core/protocol/index.js"
import { Button, Field, Icon, Input, NativeSelect, SectionHeading } from "@miragon/pulse-ui"
import { useLiveHold } from "../host/live-hold.js"
import { useSubmission } from "../host/submission.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"

const MAX_REASON_LENGTH = 500
const PICK_HINT = "Click an element on the diagram or pick it here."
const PANEL = "flex max-w-[96ch] flex-col gap-3 overflow-auto px-4 py-3"

export interface MoveChoice {
  readonly from: string
  readonly to?: string | undefined
  readonly hint?: string | undefined
}

export interface MovePanelProps {
  readonly choice: MoveChoice
  readonly option: MoveOption | undefined
  readonly fromLabel: string
  readonly onPick: (elementId: string) => void
  readonly onClose: () => void
}

function Review({ target }: { readonly target: MoveTarget }) {
  return (
    <ul
      className="border-info bg-raised m-0 flex list-disc flex-col gap-1 border-s-[3px] py-2 ps-7 pe-3"
      aria-label="What the move does"
    >
      {target.effects.map((effect) => (
        <li key={effect}>{effect}</li>
      ))}
      {target.warnings.map((warning) => (
        <li key={warning} data-part="move-warning">
          <Icon icon={TriangleAlertIcon} dense className="text-warning me-1 inline align-[-1px]" />
          {warning}
        </li>
      ))}
      <li className="font-semibold">This can't be undone.</li>
    </ul>
  )
}

function TargetPicker({
  option,
  choice,
  onPick,
}: {
  readonly option: MoveOption
  readonly choice: MoveChoice
  readonly onPick: (elementId: string) => void
}) {
  return (
    <Field label="To">
      <NativeSelect
        value={choice.to ?? ""}
        onChange={(event) => {
          onPick(event.currentTarget.value)
        }}
      >
        <option value="" disabled>
          Pick an element
        </option>
        {option.targets.map((target) => (
          <option key={target.elementId} value={target.elementId}>
            {target.elementId === option.fromElementId ? `${target.label} (again)` : target.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  )
}

function ReasonField({
  reason,
  onReason,
}: {
  readonly reason: string
  readonly onReason: (reason: string) => void
}) {
  return (
    <Field label="Reason">
      <Input
        type="text"
        maxLength={MAX_REASON_LENGTH}
        required
        placeholder="Why does the token move?"
        value={reason}
        onChange={(event) => {
          onReason(event.currentTarget.value)
        }}
      />
    </Field>
  )
}

function Gone({
  fromLabel,
  onClose,
}: {
  readonly fromLabel: string
  readonly onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
  }, [])
  return (
    <section
      className={PANEL}
      data-part="move-panel"
      role="group"
      aria-label={`Move the token at ${fromLabel}`}
    >
      <p role="status">This token is no longer at {fromLabel}.</p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" ref={close} onClick={onClose}>
          Close
        </Button>
      </div>
    </section>
  )
}

function useMoveForm(choice: MoveChoice, option: MoveOption | undefined, onClose: () => void) {
  const write = useWriteState()
  const mine = WriteStates.on(write, { kind: "token", fromElementId: choice.from })
  const submission = useSubmission(mine, onClose)
  const [reason, setReason] = useState("")
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const target = option?.targets.find((candidate) => candidate.elementId === choice.to)
  const failed =
    submission.phase !== "editing" && mine?.status === "failed" ? mine.message : undefined
  const busy = WriteStates.isWriting(write)
  const submit = (): void => {
    const why =
      target === undefined
        ? "Pick where the token goes."
        : reason.trim() === ""
          ? "Give a reason for the move."
          : undefined
    setProblem(why)
    if (why === undefined && option !== undefined && target !== undefined && !busy) {
      submission.submit({
        type: "moveToken",
        fromElementId: option.fromElementId,
        toElementId: target.elementId,
        reason,
      })
    }
  }
  return {
    target,
    reason,
    setReason,
    error: problem ?? failed,
    busy,
    pending: mine?.status === "pending",
    submit,
  }
}

function MoveActions({
  form,
  onClose,
}: {
  readonly form: ReturnType<typeof useMoveForm>
  readonly onClose: () => void
}) {
  return (
    <div className="flex gap-2">
      <Button type="button" disabled={form.busy} onClick={form.submit}>
        {form.pending ? "Moving…" : "Move…"}
      </Button>
      <Button type="button" variant="outline" onClick={onClose}>
        Cancel
      </Button>
    </div>
  )
}

export function MovePanel({ choice, option, fromLabel, onPick, onClose }: MovePanelProps) {
  useLiveHold()
  const form = useMoveForm(choice, option, onClose)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    panel.current?.querySelector("select")?.focus()
  }, [])
  if (option === undefined) {
    return <Gone fromLabel={fromLabel} onClose={onClose} />
  }
  return (
    <section
      className={PANEL}
      data-part="move-panel"
      role="group"
      aria-label={`Move the token at ${option.fromLabel}`}
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <SectionHeading as="h2" title={`Move the token at ${option.fromLabel}`} className="mb-0" />
      <TargetPicker option={option} choice={choice} onPick={onPick} />
      <p className="text-small text-muted-foreground" role="status">
        {choice.hint ?? PICK_HINT}
      </p>
      {form.target !== undefined && <Review target={form.target} />}
      <ReasonField reason={form.reason} onReason={form.setReason} />
      <p className="text-small text-muted-foreground">
        Engines with a login keep the reason in their operation log. Change variables in the
        Variables tab first if the target needs them.
      </p>
      {form.error !== undefined && (
        <p className="text-danger-ink flex items-start gap-1.5" role="alert">
          <Icon icon={CircleAlertIcon} className="text-danger mt-0.5" />
          <span className="min-w-0 wrap-anywhere">{form.error}</span>
        </p>
      )}
      <MoveActions form={form} onClose={onClose} />
    </section>
  )
}
