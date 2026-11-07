import {
  atom,
  Button,
  Callout,
  EmptyState,
  IconButton,
  Input,
  plugin,
  read,
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

interface Login {
  readonly engine: string
  readonly username: string
  readonly password: string
  readonly failed: boolean
}

const list = atom<EngineList | undefined>(undefined)
const expanded = atom<readonly string[]>([])
const login = atom<Login | undefined>(undefined)

class EnginesPanel {
  static async load(): Promise<void> {
    const answer = await plugin.request("engines.list")
    set(list, answer)
    set(
      expanded,
      answer.engines.map((engine) => `engine|${engine.name}`),
    )
  }

  static shortPath(path: string): string {
    return path.split("/").slice(-2).join("/")
  }

  static items(engines: readonly EngineRow[]): TreeItem[] {
    return engines.map((engine) => ({
      key: `engine|${engine.name}`,
      label: engine.name,
      description: engine.description,
      icon: engine.problem === undefined ? "database" : "warning",
      children:
        engine.problem === undefined
          ? engine.definitions.map((definition) => ({
              key: `definition|${engine.name}|${definition.bpmnProcessId}`,
              label: definition.label,
              description: definition.description,
              icon: definition.withIncident > 0 ? "error" : "layers",
            }))
          : [
              {
                key: `problem|${engine.name}`,
                label: engine.problem.title,
                description: engine.problem.detail,
                icon: "warning",
              },
            ],
    }))
  }

  static select(key: string): void {
    const [kind, engine] = key.split("|")
    const row = read(list)?.engines.find((candidate) => candidate.name === engine)
    const needsLogin = kind !== "definition" && row?.needsLogin === true
    set(
      login,
      needsLogin && engine !== undefined
        ? { engine, username: "", password: "", failed: false }
        : undefined,
    )
  }

  static act(key: string): void {
    const [kind, engine, bpmnProcessId] = key.split("|")
    if (kind === "definition" && engine !== undefined && bpmnProcessId !== undefined) {
      void plugin.request("views.open", { engine, view: "definition", bpmnProcessId })
      return
    }
    EnginesPanel.select(key)
  }

  static toggle(key: string, open: boolean): void {
    const others = read(expanded).filter((candidate) => candidate !== key)
    set(expanded, open ? [...others, key] : others)
  }

  static async saveLogin(): Promise<void> {
    const current = read(login)
    if (current === undefined) {
      return
    }
    const { ok } = await plugin.request("engines.setCredentials", current)
    set(login, ok ? undefined : { ...current, failed: true })
    await EnginesPanel.load()
  }
}

export function setup(context: PanelContext): void {
  context.subscriptions.push(plugin.on("engines.changed", () => void EnginesPanel.load()))
  void EnginesPanel.load()
}

function LoginForm({ current }: { readonly current: Login }) {
  return (
    <Callout tone="warning" icon="plug" title={`Sign in to ${current.engine}`}>
      <Stack gap="sm">
        <Input
          label="Username"
          value={current.username}
          onChange={(username) => {
            set(login, { ...current, username })
          }}
        />
        <Input
          label="Password"
          type="password"
          value={current.password}
          onChange={(password) => {
            set(login, { ...current, password })
          }}
        />
        {current.failed ? (
          <Text tone="danger">Pulse couldn't save the login on this machine.</Text>
        ) : null}
        <Button
          onPress={() => EnginesPanel.saveLogin()}
          disabled={current.username === "" || current.password === ""}
        >
          Save login
        </Button>
      </Stack>
    </Callout>
  )
}

export default function Panel() {
  const answer = read(list)
  const current = read(login)
  if (answer === undefined) {
    return <Spinner label="Loading engines" />
  }
  if (answer.projectFile === "") {
    return (
      <EmptyState
        icon="settings"
        title="No project file"
        description="Set Project file under Settings, Plugins, Pulse to the path of a .pulse-cli.json."
      />
    )
  }
  return (
    <Stack gap="sm">
      <Toolbar label="Engines">
        <Text muted size="xs">
          {EnginesPanel.shortPath(answer.projectFile)}
        </Text>
        <IconButton icon="refresh" label="Refresh" onPress={() => EnginesPanel.load()} />
      </Toolbar>
      {answer.problems.map((problem) => (
        <Callout key={problem} tone="danger" title={problem} />
      ))}
      <Tree
        label="Engines"
        items={EnginesPanel.items(answer.engines)}
        expanded={read(expanded)}
        onToggle={({ key, expanded: open }) => {
          EnginesPanel.toggle(key, open)
        }}
        onSelect={({ key }) => {
          EnginesPanel.select(key)
        }}
        onAction={({ key }) => {
          EnginesPanel.act(key)
        }}
      />
      {current === undefined ? null : <LoginForm current={current} />}
    </Stack>
  )
}
