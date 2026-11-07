import {
  atom,
  Button,
  Callout,
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
import type { Prompt, PromptAnswer } from "../protocol.js"
import { PanelState } from "./panel-state.js"

interface Draft {
  readonly host: string
  readonly count: string
  readonly reason: string
}

const EMPTY: Draft = { host: "", count: "", reason: "" }
const drafts = atom<Readonly<Record<string, Draft>>>({})

class PromptAnswers {
  static draftOf(id: string): Draft {
    return read(drafts)[id] ?? EMPTY
  }

  static edit(id: string, change: Partial<Draft>): void {
    set(drafts, { ...read(drafts), [id]: { ...PromptAnswers.draftOf(id), ...change } })
  }

  static async send(prompt: Prompt, answer: PromptAnswer): Promise<void> {
    await plugin.request("prompts.answer", { id: prompt.id, answer })
    set(drafts, Object.fromEntries(Object.entries(read(drafts)).filter(([id]) => id !== prompt.id)))
    await PanelState.loadPrompts()
  }

  static ready(prompt: Prompt, draft: Draft): boolean {
    if (prompt.kind === "pick") {
      return true
    }
    const hostTyped = prompt.typeHost === undefined || draft.host === prompt.typeHost
    if (prompt.kind === "confirm") {
      return hostTyped
    }
    const reasonGiven = prompt.reason?.required !== true || draft.reason.trim() !== ""
    return hostTyped && reasonGiven && draft.count === String(prompt.count)
  }

  static confirmed(prompt: Prompt, draft: Draft): PromptAnswer {
    if (prompt.kind === "bulk") {
      return {
        kind: "bulk",
        confirmed: true,
        typedCount: draft.count,
        typedHost: draft.host,
        reason: draft.reason,
      }
    }
    return { kind: "confirm", confirmed: true, typedHost: draft.host }
  }

  static cancelled(prompt: Prompt): PromptAnswer {
    return prompt.kind === "pick" ? { kind: "pick" } : { kind: prompt.kind, confirmed: false }
  }
}

function TypedFields({ prompt, draft }: { readonly prompt: Prompt; readonly draft: Draft }) {
  if (prompt.kind === "pick") {
    return null
  }
  return (
    <Stack gap="xs">
      {prompt.kind === "bulk" ? (
        <Input
          label={prompt.countPrompt}
          placeholder={String(prompt.count)}
          value={draft.count}
          onChange={(count) => {
            PromptAnswers.edit(prompt.id, { count })
          }}
        />
      ) : null}
      {prompt.typeHost === undefined ? null : (
        <Input
          label={`Type ${prompt.typeHost} to confirm`}
          value={draft.host}
          onChange={(host) => {
            PromptAnswers.edit(prompt.id, { host })
          }}
        />
      )}
      {prompt.kind === "bulk" && prompt.reason !== undefined ? (
        <Input
          label={prompt.reason.required ? "Reason (required on this engine)" : "Reason (optional)"}
          placeholder={prompt.reason.prompt}
          value={draft.reason}
          onChange={(reason) => {
            PromptAnswers.edit(prompt.id, { reason })
          }}
        />
      ) : null}
    </Stack>
  )
}

function Choices({ prompt }: { readonly prompt: Extract<Prompt, { kind: "pick" }> }) {
  return (
    <List label={prompt.title}>
      {prompt.choices.map((choice) => (
        <ListItem
          key={choice.key}
          title={choice.label}
          description={choice.description}
          onPress={() => void PromptAnswers.send(prompt, { kind: "pick", key: choice.key })}
        />
      ))}
    </List>
  )
}

export function PromptCard({ prompt }: { readonly prompt: Prompt }) {
  const draft = PromptAnswers.draftOf(prompt.id)
  return (
    <Callout tone="warning" icon="warning" title={prompt.title}>
      <Stack gap="sm">
        {prompt.kind === "pick" ? (
          <Choices prompt={prompt} />
        ) : (
          prompt.facts.map((fact) => (
            <Text key={fact} size="sm">
              {fact}
            </Text>
          ))
        )}
        {prompt.kind === "bulk" ? (
          <Text tone="warning" size="sm">
            {prompt.warning}
          </Text>
        ) : null}
        <TypedFields prompt={prompt} draft={draft} />
        <Row gap="sm">
          {prompt.kind === "pick" ? null : (
            <Button
              tone="danger"
              disabled={!PromptAnswers.ready(prompt, draft)}
              onPress={() =>
                void PromptAnswers.send(prompt, PromptAnswers.confirmed(prompt, draft))
              }
            >
              {prompt.confirmLabel}
            </Button>
          )}
          <Button
            variant="outline"
            onPress={() => void PromptAnswers.send(prompt, PromptAnswers.cancelled(prompt))}
          >
            Cancel
          </Button>
        </Row>
      </Stack>
    </Callout>
  )
}
