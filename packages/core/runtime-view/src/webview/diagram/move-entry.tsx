import { useState } from "preact/hooks"
import { useCopied } from "../components/copy-button.js"
import { Icon } from "../components/icon.js"
import { glyphs } from "../components/lucide-glyphs.json"

const MOVE_LABEL = "Move this token…"
const COPY_LABEL = "Copy CLI command"
const COPIED_LABEL = "Copied CLI command"
let refusalsInDocument = 0

function useRefusalIdUniqueAcrossOverlayRoots(): string {
  const [id] = useState(() => {
    refusalsInDocument += 1
    return `move-entry-refusal-${String(refusalsInDocument)}`
  })
  return id
}

interface CliCommandEntry {
  readonly text: string
  readonly onCopy: () => void
}

export interface MoveEntryDecoration {
  readonly elementId: string
  readonly refusal?: string
  readonly cliCommand?: CliCommandEntry
  readonly onStart: () => void
}

function CopyCliCommand({
  elementId,
  command,
  refusalId,
}: {
  readonly elementId: string
  readonly command: CliCommandEntry
  readonly refusalId: string
}) {
  const [copied, markCopied] = useCopied()
  return (
    <>
      <button
        type="button"
        class="move-entry"
        data-part="move-entry"
        data-kind="copy"
        data-move-from={elementId}
        aria-label={copied ? COPIED_LABEL : COPY_LABEL}
        aria-describedby={refusalId}
        title={copied ? "Copied" : COPY_LABEL}
        onClick={(event) => {
          event.stopPropagation()
          command.onCopy()
          markCopied()
        }}
      >
        <Icon of={copied ? glyphs.Check : glyphs.Copy} size={12} />
      </button>
      <span class="visually-hidden" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </>
  )
}

export function MoveEntry({ entry }: { readonly entry: MoveEntryDecoration }) {
  const refusalId = useRefusalIdUniqueAcrossOverlayRoots()
  if (entry.refusal !== undefined) {
    const label = `Can't move: ${entry.refusal}`
    return (
      <>
        <span
          id={refusalId}
          class="move-entry move-entry--refused"
          data-part="move-entry"
          data-state="refused"
          role="img"
          aria-label={label}
          title={label}
        >
          <Icon of={glyphs.Ban} size={12} />
        </span>
        {entry.cliCommand !== undefined && (
          <CopyCliCommand
            elementId={entry.elementId}
            command={entry.cliCommand}
            refusalId={refusalId}
          />
        )}
      </>
    )
  }
  return (
    <button
      type="button"
      class="move-entry"
      data-part="move-entry"
      data-kind="move"
      data-move-from={entry.elementId}
      aria-label={MOVE_LABEL}
      title={MOVE_LABEL}
      onClick={(event) => {
        event.stopPropagation()
        entry.onStart()
      }}
    >
      <Icon of={glyphs.MoveRight} size={12} />
    </button>
  )
}
