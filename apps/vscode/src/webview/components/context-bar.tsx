import type { ComponentChildren } from "preact"
import { glyphs } from "./lucide-glyphs.json"
import type { EngineBadge } from "../../core/protocol/index.js"
import { BackButton } from "./back-button.js"
import { Icon } from "./icon.js"
import { FreshnessStamp, LiveButton, type Freshness } from "./live-stamp.js"

export type { Freshness } from "./live-stamp.js"

type Subject = "engine" | "definition" | "instance" | "migration"

const SUBJECT_GLYPHS: Readonly<Record<Subject, string>> = {
  engine: glyphs.Server,
  definition: glyphs.Workflow,
  instance: glyphs.CircleDot,
  migration: glyphs.Workflow,
}

export interface ContextBarProps {
  readonly subject?: Subject
  readonly title: string
  readonly engine: EngineBadge
  readonly freshness: Freshness
  readonly children?: ComponentChildren
}

function AccessChip({ engine }: { readonly engine: EngineBadge }) {
  const writable = engine.access?.writable === true
  return (
    <span
      class={`read-only${writable ? " read-only--writable" : ""}`}
      title={engine.access?.note ?? "Pulse only reads from the engine."}
    >
      <Icon of={writable ? glyphs.Pencil : glyphs.Eye} />
      <span class="read-only__label">{writable ? "Writable" : "Read-only"}</span>
    </span>
  )
}

export function ContextBar({ subject, title, engine, freshness, children }: ContextBarProps) {
  return (
    <header class={`context-bar context-bar--${subject ?? "pending"}`}>
      <div class="context-bar__subject">
        <BackButton class="context-bar__back" />
        {subject !== undefined && <Icon of={SUBJECT_GLYPHS[subject]} />}
        <h1 class="context-bar__title">{title}</h1>
        {children}
      </div>
      <div class="context-bar__meta">
        <AccessChip engine={engine} />
        <span class="context-bar__divider" aria-hidden="true" />
        {freshness.kind !== "loading" && <LiveButton live={freshness.live} />}
        <FreshnessStamp freshness={freshness} />
      </div>
    </header>
  )
}
