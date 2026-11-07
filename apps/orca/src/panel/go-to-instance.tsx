import { atom, Input, List, ListItem, plugin, read, set, Stack, Text } from "orca"
import { PanelState } from "./panel-state.js"

const query = atom("")
const missed = atom<string | undefined>(undefined)

class InstanceSearch {
  static async find(text: string, engine: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed === "") {
      return
    }
    const { found } = await plugin.request("instances.find", { query: trimmed })
    const [first] = found
    set(
      missed,
      first === undefined
        ? `No instance with the ID or business key "${trimmed}" on ${engine}.`
        : undefined,
    )
    if (found.length === 1 && first !== undefined) {
      InstanceSearch.open(engine, first.instanceId)
      return
    }
    set(PanelState.found, found.length === 0 ? undefined : found)
  }

  static open(engine: string, instanceId: string): void {
    set(PanelState.found, undefined)
    void plugin.request("views.open", { engine, view: "instance", instanceId })
  }
}

export function GoToInstance({ engine }: { readonly engine: string }) {
  const found = read(PanelState.found)
  const problem = read(missed)
  return (
    <Stack gap="xs">
      <Input
        label={`Go to a process instance on ${engine}`}
        type="search"
        placeholder="Instance ID or business key"
        value={read(query)}
        onChange={(text) => {
          set(query, text)
        }}
        onSubmit={(text) => void InstanceSearch.find(text, engine)}
      />
      {problem === undefined ? null : (
        <Text muted size="sm">
          {problem}
        </Text>
      )}
      {found === undefined ? null : (
        <List label={`${found.length} instances`}>
          {found.map((instance) => (
            <ListItem
              key={instance.instanceId}
              title={instance.label}
              description={instance.description}
              icon="file-text"
              onPress={() => {
                InstanceSearch.open(engine, instance.instanceId)
              }}
            />
          ))}
        </List>
      )}
    </Stack>
  )
}
