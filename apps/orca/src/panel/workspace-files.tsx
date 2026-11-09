import {
  atom,
  Button,
  Collapsible,
  Input,
  List,
  ListItem,
  plugin,
  read,
  Row,
  set,
  Stack,
  Text,
} from "orca"
import { PanelState } from "./panel-state.js"

const boardTitle = atom("")

class FileActions {
  static async createBoard(): Promise<void> {
    const title = read(boardTitle).trim()
    if (title === "") {
      return
    }
    await plugin.request("boards.create", { title })
    set(boardTitle, "")
    await PanelState.loadFiles()
  }
}

export function Boards() {
  const boards = read(PanelState.boards)
  return (
    <Collapsible title="Boards" description={`${boards.length} in this project`}>
      <Stack gap="sm">
        {boards.length === 0 ? (
          <Text muted size="sm">
            No boards yet.
          </Text>
        ) : (
          <List label="Boards">
            {boards.map((board) => (
              <ListItem
                key={board.path}
                title={board.label}
                description={board.description}
                icon="gauge"
                onPress={() => void plugin.request("boards.open", { path: board.path })}
              />
            ))}
          </List>
        )}
        <Row gap="sm">
          <Input
            label="New board"
            labelHidden
            placeholder="Title of a new board"
            value={read(boardTitle)}
            onChange={(title) => {
              set(boardTitle, title)
            }}
            onSubmit={() => void FileActions.createBoard()}
          />
          <Button icon="add" variant="outline" onPress={() => void FileActions.createBoard()}>
            New board
          </Button>
        </Row>
      </Stack>
    </Collapsible>
  )
}

export function Models({ engine }: { readonly engine: string }) {
  const models = read(PanelState.models)
  return (
    <Collapsible title="Local models" description={`Runtime data on ${engine}`}>
      {models.length === 0 ? (
        <Text muted size="sm">
          No .bpmn files in this project.
        </Text>
      ) : (
        <List label="Local models">
          {models.map((model) => (
            <ListItem
              key={`${model.path}|${model.bpmnProcessId}`}
              title={model.label}
              description={model.description}
              icon="file"
              onPress={() =>
                void plugin.request("views.open", {
                  engine,
                  view: "model",
                  bpmnProcessId: model.bpmnProcessId,
                  modelPath: model.path,
                })
              }
            />
          ))}
        </List>
      )}
    </Collapsible>
  )
}
