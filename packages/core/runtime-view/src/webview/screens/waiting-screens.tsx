import { cn, LoadingState } from "@miragon/pulse-ui"
import { useEffect, useState } from "react"
import type { EngineBadge, Problem } from "../../core/protocol/index.js"
import { ContextBar } from "../components/context-bar.js"
import { DataTable } from "../components/data-table.js"
import { ProblemBox } from "./notices.js"
import { ScreenFrame } from "./screen-frame.js"

const SKELETON_DELAY_MS = 400

const CENTRED = "grid place-items-center"

const FAILED = "grid place-items-center p-6 [&>*]:w-[min(560px,100%)]"

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
    <div className={ScreenFrame.PLAIN} aria-busy="true">
      <ContextBar title={title} engine={engine} freshness={{ kind: "loading" }} />
      <div
        className="grid min-h-0 grid-rows-[minmax(0,55fr)_minmax(0,45fr)]"
        data-part="loading-layout"
        data-skeleton={showSkeleton}
      >
        <section className={cn("bg-background relative h-full overflow-hidden", CENTRED)}>
          {showSkeleton && <LoadingState />}
        </section>
        <section className={cn(ScreenFrame.LIST_REGION, "border-border border-t")}>
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
    <div className={ScreenFrame.PLAIN}>
      <ContextBar
        title={engine.name}
        engine={engine}
        freshness={{ kind: "offline", loginRefused: problem.loginRefused }}
      />
      <div className={FAILED}>
        <ProblemBox problem={problem} />
      </div>
    </div>
  )
}

export function BlankScreen() {
  const showLoader = useDelayed(SKELETON_DELAY_MS)
  return <div className={cn("h-full min-w-0", FAILED)}>{showLoader && <LoadingState />}</div>
}
