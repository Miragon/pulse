import { FileCodeIcon, PencilIcon, ServerIcon } from "lucide-react"
import { Button, Icon, cn } from "@miragon/pulse-ui"
import type { BoardEngineStatus } from "../../../core/protocol/index.js"
import { StatusStrip, type StripAction } from "../../components/status-strip.js"
import { useHost } from "../../host/host-context.js"
import { BoardLabels } from "./board-labels.js"

function useFailedActions(engine: BoardEngineStatus): StripAction[] {
  const host = useHost()
  const actions: StripAction[] = []
  if (engine.problem?.needsCredentials === true) {
    actions.push({
      label: "Set credentials…",
      icon: PencilIcon,
      onClick: () => {
        host.post({ type: "setBoardCredentials", engine: engine.name })
      },
    })
  }
  if (engine.problem?.canEditConnection === true) {
    actions.push({
      label: "Edit connection…",
      icon: FileCodeIcon,
      onClick: () => {
        host.post({ type: "editConnection" })
      },
    })
  }
  return actions
}

function EngineProblem({ engine }: { readonly engine: BoardEngineStatus }) {
  const host = useHost()
  const actions = useFailedActions(engine)
  if (engine.state === "notConfigured") {
    return (
      <StatusStrip
        tone="warning"
        title={`${engine.name} is not in .pulse.json.`}
        detail="Its widgets stay empty until a profile of that name exists."
        actions={[
          {
            label: "Edit connection…",
            icon: FileCodeIcon,
            onClick: () => {
              host.post({ type: "editConnection" })
            },
          },
        ]}
      />
    )
  }
  return (
    <StatusStrip
      tone="danger"
      title={engine.problem?.title ?? `Can't read ${engine.name}.`}
      detail={engine.problem?.detail}
      actions={actions}
    />
  )
}

function EngineChip({ engine }: { readonly engine: BoardEngineStatus }) {
  const host = useHost()
  const production = engine.badge?.environment === "production"
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="max-w-full min-w-0 gap-1.5 px-1.5 font-normal has-[>svg]:px-1.5"
      title={BoardLabels.openTitle({ engine: engine.name, filter: { scope: "all" } })}
      onClick={(event) => {
        host.post({
          type: "openBoardEngine",
          engine: engine.name,
          toSide: event.ctrlKey || event.metaKey,
        })
      }}
    >
      <Icon icon={ServerIcon} />
      <span className={cn("font-semibold", production && "text-danger-ink")}>{engine.name}</span>
      <span className="text-muted-foreground min-w-0 truncate">
        {BoardLabels.engineFacts(engine)}
      </span>
    </Button>
  )
}

export function BoardEngines({ engines }: { readonly engines: readonly BoardEngineStatus[] }) {
  const ready = engines.filter((engine) => engine.state === "ready")
  return (
    <>
      {engines
        .filter((engine) => engine.state !== "ready")
        .map((engine) => (
          <EngineProblem key={engine.name} engine={engine} />
        ))}
      {ready.length > 0 && (
        <div
          className="bg-card border-border px-gutter flex flex-wrap gap-x-3 gap-y-0.5 border-b py-1"
          role="group"
          aria-label="Engines of this board"
        >
          {ready.map((engine) => (
            <EngineChip key={engine.name} engine={engine} />
          ))}
        </div>
      )}
    </>
  )
}
