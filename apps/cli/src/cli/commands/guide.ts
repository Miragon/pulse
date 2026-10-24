/**
 * `operate guide [topic] | --list` (design §5, §19): prints the usage guide for agents. The core
 * and every topic are always the raw markdown, whatever the output format, so that they read the
 * same in a terminal, a pipe and an agent's context; `--list` lists the topics as JSON when stdout
 * is not a terminal, else as a table.
 */

import { type Command, Option } from "commander"
import { OUTPUT_FORMATS } from "../../config/types.js"
import { findGuideTopic, GUIDE, GUIDE_TOPICS, topicSuggestions } from "../../docs/guide.js"
import { type OperateError, usageError } from "../../errors.js"
import { renderTable } from "../../output/table.js"
import { compact } from "../../util.js"
import { subcommand } from "../command.js"
import { setOptionCompletion, setPositional } from "../completion-meta.js"
import type { CliContext } from "../context.js"
import { displayOf, displayText } from "../display.js"
import { didYouMean } from "./suggest.js"
import type { UtilityCommand } from "./types.js"

const TOPIC_NAMES = GUIDE_TOPICS.map((topic) => topic.name)
const TOPIC_TABLE = { columns: ["TOPIC", "SUMMARY"], fixed: ["TOPIC"] }

const DESCRIPTION = [
  "Print the usage guide for agents and scripts as markdown. Without a topic: the core guide (setup, discover, describe, preview, run, workflow commands, conventions, output, errors and exit codes, safety) and the index of the topics. With a topic: its details.",
  "",
  `Topics: ${TOPIC_NAMES.join(", ")}. --list lists them with a summary (JSON when stdout is not a terminal, else a table). The guide is always markdown; -o/--output only formats --list. skills/operate/SKILL.md of the npm package holds the core guide as an agent skill.`,
].join("\n")

interface GuideOptions {
  readonly list?: boolean
  readonly output?: string
}

function unknownTopic(name: string): OperateError {
  return usageError(
    `Unknown guide topic "${name}"`,
    `${didYouMean(topicSuggestions(name))}The topics are ${TOPIC_NAMES.join(", ")} ("operate guide --list" summarizes them); "operate guide" alone prints the core guide.`,
  )
}

/** `--list` with a topic; the hint offers the topic only when it exists. */
function listWithTopic(name: string): OperateError {
  const one = findGuideTopic(name) === undefined ? "" : ` or "operate guide ${name}" for one topic`
  return usageError(
    `--list takes no topic, got "${name}"`,
    `Run "operate guide --list" for the topics${one}.`,
  )
}

/** The markdown of a topic; an unknown name is a USAGE error with suggestions. */
function topicText(name: string): string {
  const topic = findGuideTopic(name)
  if (topic === undefined) throw unknownTopic(name)
  return topic.text
}

async function listTopics(options: GuideOptions, context: CliContext): Promise<string> {
  const display = await displayOf(context, compact({ output: options.output }))
  const topics = GUIDE_TOPICS.map(({ name, summary }) => ({ topic: name, summary }))
  const rows = topics.map((topic) => ({ TOPIC: topic.topic, SUMMARY: topic.summary }))
  return displayText(
    topics,
    display,
    () => `${renderTable(rows, { ...TOPIC_TABLE, maxWidth: display.maxWidth })}\n`,
  )
}

async function runGuide(
  name: string | undefined,
  command: Command,
  context: CliContext,
): Promise<void> {
  const options = command.opts<GuideOptions>()
  if (options.list === true && name !== undefined) throw listWithTopic(name)
  if (options.list === true) {
    context.runtime.stdout.write(await listTopics(options, context))
    return
  }
  context.runtime.stdout.write(name === undefined ? GUIDE : topicText(name))
}

export const guideCommand: UtilityCommand = {
  name: "guide",
  nested: false,
  register(program, context) {
    const output = new Option(
      "-o, --output <format>",
      "Format of --list: json or table (the guide itself is always markdown)",
    )
    setOptionCompletion(output, { values: OUTPUT_FORMATS })
    const command = subcommand(program, "guide")
      .summary("Print the usage guide for agents (markdown)")
      .description(DESCRIPTION)
      .usage("[topic] [options]")
      .argument("[topic]", `Topic: ${TOPIC_NAMES.join(", ")}`)
      .option("--list", "List the topics with a summary")
      .addOption(output)
    setPositional(command, {
      kind: "values",
      values: TOPIC_NAMES,
      descriptions: Object.fromEntries(GUIDE_TOPICS.map((topic) => [topic.name, topic.summary])),
    })
    command.action((name: string | undefined) => runGuide(name, command, context))
  },
}
