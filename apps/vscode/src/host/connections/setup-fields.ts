import type { EngineSetup, SetupChoice, SetupField, SetupValues } from "../../contract/index.js"
import { TargetsParser } from "./targets-parser.js"

const ENVIRONMENTS: readonly SetupChoice[] = [
  {
    value: "test",
    label: "Test",
    detail: "Shown as TEST. By default, open views read it again on their own.",
  },
  {
    value: "production",
    label: "Production",
    detail: "Shown in red as PROD. By default, views read it again only when you refresh them.",
  },
  {
    value: "",
    label: "Leave it unclassified",
    detail: "No label. By default, views read it again only when you refresh them.",
  },
]

export class SetupFields {
  static completed(setup: EngineSetup, taken: ReadonlySet<string>): EngineSetup {
    return {
      label: setup.label,
      detail: setup.detail,
      title: setup.title,
      fields: [
        ...setup.fields,
        SetupFields.name((values) => setup.suggestedName(values), taken),
        SetupFields.environment(),
      ],
      suggestedName: (values) => setup.suggestedName(values),
      profileOf: (values) => setup.profileOf(values),
      credentialsOf: (values) => setup.credentialsOf(values),
    }
  }

  static name(suggestion: (values: SetupValues) => string, taken: ReadonlySet<string>): SetupField {
    return {
      key: "name",
      title: "Name",
      prompt: "The engine's name in the Engines view, in .pulse-cli.json and for the CLI.",
      initial: suggestion,
      problem: (value) => SetupFields.nameProblem(value, taken),
    }
  }

  static environment(): SetupField {
    return {
      key: "environment",
      title: "Environment",
      prompt: "Test or production? Pulse keeps the answer in your user settings.",
      choices: ENVIRONMENTS,
    }
  }

  private static nameProblem(value: string, taken: ReadonlySet<string>): string | undefined {
    if (!TargetsParser.isProfileName(value)) {
      return 'Use letters, digits, ".", "_" and "-", and start with a letter or digit.'
    }
    return taken.has(value)
      ? `Pulse already reads an engine named ${value}. Choose another name.`
      : undefined
  }
}
