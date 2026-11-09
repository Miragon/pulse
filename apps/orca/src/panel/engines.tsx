import {
  Callout,
  EmptyState,
  IconButton,
  plugin,
  read,
  Select,
  set,
  Spinner,
  Stack,
  Text,
  Toolbar,
  Tree,
  type PanelContext,
  type TreeItem,
} from "orca"
import type { EngineList, EngineRow } from "../protocol.js"
import { GoToInstance } from "./go-to-instance.js"
import { LoginForm } from "./login-form.js"
import { PanelState } from "./panel-state.js"
import { PromptCard } from "./prompt-card.js"
import { Boards, Models } from "./workspace-files.js"

class EnginesTree {
  static items(engines: readonly EngineRow[]): TreeItem[] {
    return engines.map((engine) => ({
      key: `engine|${engine.name}`,
      label: engine.active ? `${engine.name} (active)` : engine.name,
      description: engine.description,
      icon: engine.problem === undefined ? (engine.writable ? "edit" : "database") : "warning",
      children: EnginesTree.children(engine),
    }))
  }

  static select(key: string): void {
    set(PanelState.selected, key)
    const [kind, engine] = key.split("|")
    const row = read(PanelState.list)?.engines.find((candidate) => candidate.name === engine)
    const needsLogin = kind !== "definition" && row?.needsLogin === true
    set(
      PanelState.login,
      needsLogin && engine !== undefined
        ? { engine, username: "", password: "", failed: false }
        : undefined,
    )
  }

  static act(key: string): void {
    const [kind, engine, bpmnProcessId] = key.split("|")
    if (engine === undefined) {
      return
    }
    if (kind === "definition" && bpmnProcessId !== undefined) {
      void plugin.request("views.open", { engine, view: "definition", bpmnProcessId })
      return
    }
    if (kind === "engine") {
      void plugin.request("views.open", { engine, view: "engine" })
      return
    }
    EnginesTree.select(key)
  }

  static selection(): { selected?: string } {
    const selected = read(PanelState.selected)
    return selected === undefined ? {} : { selected }
  }

  static toggle(key: string, open: boolean): void {
    const others = read(PanelState.expanded).filter((candidate) => candidate !== key)
    set(PanelState.expanded, open ? [...others, key] : others)
  }

  private static children(engine: EngineRow): readonly TreeItem[] {
    if (engine.problem !== undefined) {
      return [
        {
          key: `problem|${engine.name}`,
          label: engine.problem.title,
          description: engine.problem.detail,
          icon: "warning",
        },
      ]
    }
    if (engine.definitions.length === 0) {
      return [
        { key: `empty|${engine.name}`, label: "No process definitions deployed", icon: "layers" },
      ]
    }
    return engine.definitions.map((definition) => ({
      key: `definition|${engine.name}|${definition.bpmnProcessId}`,
      label: definition.label,
      description: definition.description,
      icon: definition.withIncident > 0 ? "error" : "layers",
    }))
  }
}

export function setup(context: PanelContext): void {
  PanelState.setup(context)
}

function Header({ answer }: { readonly answer: EngineList }) {
  const shown =
    answer.projectFile === ""
      ? "Default engine on localhost"
      : answer.projectFile.split("/").slice(-2).join("/")
  return (
    <Toolbar label="Engines">
      <Text muted size="xs">
        {shown}
      </Text>
      <IconButton
        icon="refresh"
        label="Refresh"
        onPress={() => void Promise.all([PanelState.load(), PanelState.loadFiles()])}
      />
      <IconButton
        icon="settings"
        label="Configure engines"
        onPress={() => void plugin.request("engines.configure")}
      />
    </Toolbar>
  )
}

function ActiveEngine({ engines }: { readonly engines: readonly EngineRow[] }) {
  if (engines.length < 2) {
    return null
  }
  const active = engines.find((engine) => engine.active)?.name ?? ""
  return (
    <Select
      label="Active engine"
      value={active}
      options={engines.map((engine) => ({ value: engine.name, label: engine.name }))}
      onChange={(engine) => void plugin.request("engines.activate", { engine })}
    />
  )
}

export default function Panel() {
  PanelState.reportVisibility()
  const answer = read(PanelState.list)
  if (answer === undefined) {
    return <Spinner label="Loading engines" />
  }
  const login = read(PanelState.login)
  const active = answer.engines.find((engine) => engine.active)
  return (
    <Stack gap="sm">
      <Header answer={answer} />
      {read(PanelState.prompts).map((prompt) => (
        <PromptCard key={prompt.id} prompt={prompt} />
      ))}
      {read(PanelState.notices).map((notice, index) => (
        <Callout key={`${index}|${notice.text}`} tone={notice.tone} title={notice.text} />
      ))}
      {answer.problems.map((problem) => (
        <Callout key={problem} tone="danger" title={problem} />
      ))}
      <ActiveEngine engines={answer.engines} />
      {active === undefined ? null : <GoToInstance engine={active.name} />}
      {answer.engines.length === 0 ? (
        <EmptyState
          icon="database"
          title="No engines"
          description="Configure engines in a .pulse.json."
        />
      ) : (
        <Tree
          label="Engines"
          items={EnginesTree.items(answer.engines)}
          {...EnginesTree.selection()}
          expanded={read(PanelState.expanded)}
          onToggle={({ key, expanded }) => {
            EnginesTree.toggle(key, expanded)
          }}
          onSelect={({ key }) => {
            EnginesTree.select(key)
          }}
          onAction={({ key }) => {
            EnginesTree.act(key)
          }}
        />
      )}
      {login === undefined ? null : <LoginForm current={login} />}
      {active === undefined ? null : <Models engine={active.name} />}
      <Boards />
    </Stack>
  )
}
