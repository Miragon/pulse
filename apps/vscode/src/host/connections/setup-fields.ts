import type { SetupChoice, SetupField, SetupValues } from "./setup-field.js"
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
  static valueOf(values: SetupValues, key: string): string {
    return values[key] ?? ""
  }

  static notBlank(what: string): (value: string) => string | undefined {
    return (value) => (value.trim() === "" ? `Enter ${what}.` : undefined)
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
      prompt: "How should Pulse treat this engine? Pulse keeps your answer in your user settings.",
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
