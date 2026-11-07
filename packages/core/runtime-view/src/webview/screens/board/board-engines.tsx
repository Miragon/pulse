import type { BoardEngineStatus } from "../../../core/protocol/index.js"
import { Icon } from "../../components/icon.js"
import { glyphs } from "../../components/lucide-glyphs.json"
import { StatusStrip, type StripAction } from "../../components/status-strip.js"
import { useHost } from "../../host/host-context.js"
import { BoardLabels } from "./board-labels.js"

function useFailedActions(engine: BoardEngineStatus): StripAction[] {
  const host = useHost()
  const actions: StripAction[] = []
  if (engine.problem?.needsCredentials === true) {
    actions.push({
      label: "Set credentials…",
      icon: glyphs.Pencil,
      onClick: () => {
        host.post({ type: "setBoardCredentials", engine: engine.name })
      },
    })
  }
  if (engine.problem?.canEditConnection === true) {
    actions.push({
      label: "Edit connection…",
      icon: glyphs.FileCode,
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
        title={`${engine.name} is not in .pulse-cli.json.`}
        detail="Its widgets stay empty until a profile of that name exists."
        actions={[
          {
            label: "Edit connection…",
            icon: glyphs.FileCode,
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
    <button
      type="button"
      class={`board-engine${production ? " board-engine--production" : ""}`}
      title={BoardLabels.openTitle({ engine: engine.name, filter: { scope: "all" } })}
      onClick={(event) => {
        host.post({
          type: "openBoardEngine",
          engine: engine.name,
          toSide: event.ctrlKey || event.metaKey,
        })
      }}
    >
      <Icon of={glyphs.Server} />
      <span class="board-engine__name">{engine.name}</span>
      <span class="board-engine__facts">{BoardLabels.engineFacts(engine)}</span>
    </button>
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
        <div class="board-engines" role="group" aria-label="Engines of this board">
          {ready.map((engine) => (
            <EngineChip key={engine.name} engine={engine} />
          ))}
        </div>
      )}
    </>
  )
}
