import { useEffect, useState } from "preact/hooks"
import { glyphs } from "../components/lucide-glyphs.json"
import type { EngineBadge, Problem } from "../../core/protocol/index.js"
import { ContextBar } from "../components/context-bar.js"
import { DataTable } from "../components/data-table.js"
import { EmptyHint } from "../components/empty-hint.js"
import { Icon } from "../components/icon.js"
import { ProblemBox } from "./notices.js"

const SKELETON_DELAY_MS = 400

const SKELETON_COLUMNS = [
  { key: "a", label: "", render: () => null },
  { key: "b", label: "", render: () => null },
  { key: "c", label: "", render: () => null },
  { key: "d", label: "", render: () => null },
] as const

function useDelayed(delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setElapsed(true)
    }, delayMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [delayMs])
  return elapsed
}

export function LoadingScreen({
  title,
  engine,
}: {
  readonly title: string
  readonly engine: EngineBadge
}) {
  const showSkeleton = useDelayed(SKELETON_DELAY_MS)
  return (
    <div class="screen" aria-busy="true">
      <ContextBar title={title} engine={engine} freshness={{ kind: "loading" }} />
      <div class="loading-layout" data-skeleton={showSkeleton}>
        <section class="diagram-region diagram-region--placeholder">
          {showSkeleton && (
            <EmptyHint text="Loading…" busy>
              <Icon of={glyphs.LoaderCircle} class="spin" />
            </EmptyHint>
          )}
        </section>
        <section class="list-region">
          {showSkeleton && (
            <DataTable
              label="Loading"
              columns={SKELETON_COLUMNS}
              rows={[]}
              rowKey={() => ""}
              empty={null}
              skeletonRows={5}
            />
          )}
        </section>
      </div>
    </div>
  )
}

export function FailedScreen({
  problem,
  engine,
}: {
  readonly problem: Problem
  readonly engine: EngineBadge
}) {
  return (
    <div class="screen">
      <ContextBar title={engine.name} engine={engine} freshness={{ kind: "offline" }} />
      <div class="failed-layout">
        <ProblemBox problem={problem} />
      </div>
    </div>
  )
}

export function BlankScreen() {
  const showLoader = useDelayed(SKELETON_DELAY_MS)
  return (
    <div class="screen failed-layout">
      {showLoader && (
        <EmptyHint text="Loading…" busy>
          <Icon of={glyphs.LoaderCircle} class="spin" />
        </EmptyHint>
      )}
    </div>
  )
}
