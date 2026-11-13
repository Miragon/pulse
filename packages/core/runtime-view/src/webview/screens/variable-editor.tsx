import { useEffect, useId, useRef, useState } from "preact/hooks"
import type { VariableEditor as EditorKind, VariableRow } from "../../core/protocol/index.js"
import { useLiveHold } from "../host/live-hold.js"
import { useSubmission } from "../host/submission.js"
import { useWriteState } from "../host/write-context.js"
import { WriteStates } from "../host/write-states.js"
import { VariableEditorText, WRITE_AS, type InputKind } from "./variable-editor-text.js"

export interface VariableEditorProps {
  readonly row: VariableRow
  readonly editor: EditorKind
  readonly shadowedBy?: string | undefined
  readonly onClose: () => void
}

interface RefusedInput {
  readonly errorId: string
  readonly refusal: number
}

function ValueInput({
  kind,
  text,
  onText,
  refused,
}: {
  readonly kind: InputKind
  readonly text: string
  readonly onText: (text: string) => void
  readonly refused: RefusedInput | undefined
}) {
  const field = useRef<HTMLTextAreaElement & HTMLSelectElement>(null)
  const refusal = refused?.refusal
  useEffect(() => {
    field.current?.focus()
  }, [kind])
  useEffect(() => {
    if (refusal !== undefined) {
      field.current?.focus()
    }
  }, [refusal])
  const validity = {
    "aria-invalid": refused !== undefined || undefined,
    "aria-describedby": refused?.errorId,
  }
  if (kind === "boolean") {
    return (
      <select
        ref={field}
        class="variable-editor__field"
        aria-label="New value"
        {...validity}
        value={text}
        onChange={(event) => {
          onText(event.currentTarget.value)
        }}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    )
  }
  return (
    <textarea
      ref={field}
      class="variable-editor__field"
      aria-label="New value"
      {...validity}
      rows={Math.min(12, Math.max(1, text.split("\n").length))}
      spellcheck={false}
      placeholder={kind === "date" ? "2026-10-22T10:00:00Z" : undefined}
      value={text}
      onInput={(event) => {
        onText(event.currentTarget.value)
      }}
    />
  )
}

function WriteAsPicker({
  kind,
  onKind,
}: {
  readonly kind: InputKind
  readonly onKind: (kind: InputKind) => void
}) {
  return (
    <label class="variable-editor__write-as">
      Write as
      <select
        class="variable-editor__kind"
        value={kind}
        onChange={(event) => {
          onKind(event.currentTarget.value as InputKind)
        }}
      >
        {WRITE_AS.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

function useEditor(row: VariableRow, editor: EditorKind, onClose: () => void) {
  const write = useWriteState()
  const mine = WriteStates.on(write, { kind: "variable", name: row.name })
  const [kind, setKindState] = useState<InputKind>(editor === "any" ? "text" : editor)
  const [text, setText] = useState(() => VariableEditorText.initial(row, kind))
  const submission = useSubmission(mine, onClose)
  const setKind = (next: InputKind): void => {
    setKindState(next)
    setText(VariableEditorText.initial(row, next))
  }
  const valueJson = VariableEditorText.valueJsonOf(kind, text)
  return {
    kind,
    setKind,
    text,
    setText,
    valueJson,
    mine,
    submission,
    busy: WriteStates.isWriting(write),
  }
}

function EditorActions({
  row,
  state,
  unchanged,
  onSave,
  onClose,
}: {
  readonly row: VariableRow
  readonly state: ReturnType<typeof useEditor>
  readonly unchanged: boolean
  readonly onSave: () => void
  readonly onClose: () => void
}) {
  return (
    <div class="variable-editor__actions">
      <button
        type="button"
        class="button button--primary"
        disabled={unchanged || state.busy}
        onClick={onSave}
      >
        {state.mine?.status === "pending" ? "Saving…" : "Save"}
      </button>
      <button type="button" class="button button--secondary" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        class="button button--ghost"
        disabled={state.busy || row.valueJson === "null"}
        onClick={() => {
          state.submission.submit({ type: "setVariable", name: row.name, valueJson: "null" })
        }}
      >
        Set to null
      </button>
    </div>
  )
}

function EditorNotes({
  row,
  kind,
  shadowedBy,
}: {
  readonly row: VariableRow
  readonly kind: InputKind
  readonly shadowedBy: string | undefined
}) {
  return (
    <>
      <p class="variable-editor__hint muted" data-part="editor-hint">
        {VariableEditorText.was(row, kind)}
      </p>
      {shadowedBy !== undefined && (
        <p class="variable-editor__warning" data-part="editor-warning">
          {shadowedBy} keeps its own {row.name}; this change does not reach it.
        </p>
      )}
    </>
  )
}

export function VariableEditor({ row, editor, shadowedBy, onClose }: VariableEditorProps) {
  useLiveHold()
  const state = useEditor(row, editor, onClose)
  const unchanged = state.valueJson === row.valueJson
  const save = (): void => {
    if (!unchanged && !state.busy) {
      state.submission.submit({ type: "setVariable", name: row.name, valueJson: state.valueJson })
    }
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation()
    if (event.key === "Escape") {
      onClose()
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    }
  }
  const errorId = useId()
  const failed = state.submission.phase !== "editing" ? state.mine : undefined
  const refusal = failed?.status === "failed" ? failed.inputRefusal : undefined
  return (
    <div
      class="variable-editor"
      role="group"
      aria-label={`Edit ${row.name}`}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        event.stopPropagation()
      }}
    >
      {editor === "any" && <WriteAsPicker kind={state.kind} onKind={state.setKind} />}
      <ValueInput
        kind={state.kind}
        text={state.text}
        onText={state.setText}
        refused={refusal === undefined ? undefined : { errorId, refusal }}
      />
      <EditorNotes row={row} kind={state.kind} shadowedBy={shadowedBy} />
      {failed?.status === "failed" && (
        <p key={refusal} id={errorId} class="variable-editor__error" role="alert">
          {failed.message}
        </p>
      )}
      <EditorActions
        row={row}
        state={state}
        unchanged={unchanged}
        onSave={save}
        onClose={onClose}
      />
    </div>
  )
}
