import type { EngineSetup, SetupField, SetupValues } from "../../contract/index.js"
import type { PromptItem, Prompts } from "./prompts.js"

const SAVE = "save"
const HIDDEN = "••••••••"

type ReviewChoice = typeof SAVE | SetupField

export class SetupSteps {
  constructor(private readonly prompts: Prompts) {}

  async ask(setup: EngineSetup): Promise<SetupValues | undefined> {
    const values = await this.fill(setup, {})
    return values === undefined ? undefined : this.review(setup, values)
  }

  async review(setup: EngineSetup, values: SetupValues): Promise<SetupValues | undefined> {
    const choice = await this.prompts.pick(
      `${setup.title}: check the details`,
      this.reviewItems(setup, values),
      "Pick a value to change it, or save.",
    )
    if (choice === undefined || choice === SAVE) {
      return choice === SAVE ? values : undefined
    }
    const answer = await this.answer(setup, choice, values)
    const changed =
      answer === undefined ? values : await this.fill(setup, { ...values, [choice.key]: answer })
    return this.review(setup, changed ?? values)
  }

  private async fill(setup: EngineSetup, start: SetupValues): Promise<SetupValues | undefined> {
    let values = start
    for (const field of setup.fields) {
      if (Object.hasOwn(values, field.key) || !SetupSteps.visible(field, values)) {
        continue
      }
      const answer = await this.answer(setup, field, values)
      if (answer === undefined) {
        return undefined
      }
      values = { ...values, [field.key]: answer }
    }
    return values
  }

  private async answer(
    setup: EngineSetup,
    field: SetupField,
    values: SetupValues,
  ): Promise<string | undefined> {
    const title = SetupSteps.titleOf(setup, field, values)
    if (field.choices !== undefined) {
      return this.prompts.pick(
        title,
        field.choices.map((choice) => ({
          label: choice.label,
          detail: choice.detail,
          item: choice.value,
        })),
        field.prompt,
      )
    }
    const answer = await this.prompts.input({
      title,
      prompt: field.prompt,
      value: values[field.key] ?? field.initial?.(values) ?? "",
      password: field.password === true,
      validate: (value) => SetupSteps.problemOf(field, value, values),
    })
    return answer === undefined || field.password === true ? answer : answer.trim()
  }

  private reviewItems(setup: EngineSetup, values: SetupValues): PromptItem<ReviewChoice>[] {
    const fields = setup.fields.filter((field) => SetupSteps.visible(field, values))
    const secret = fields.some((field) => field.password === true)
    return [
      {
        label: "$(check) Save and connect",
        detail: secret
          ? "Writes .pulse-cli.json and keeps the secret in VS Code's secret storage."
          : "Writes .pulse-cli.json and reads the engine once.",
        item: SAVE,
      },
      ...fields.map((field) => ({
        label: field.title,
        description: SetupSteps.shown(field, values[field.key] ?? ""),
        item: field,
      })),
    ]
  }

  private static problemOf(
    field: SetupField,
    value: string,
    values: SetupValues,
  ): string | undefined {
    const typed = field.password === true ? value : value.trim()
    if (typed === "") {
      return field.optional === true
        ? undefined
        : (field.problem?.(typed, values) ?? "Enter a value.")
    }
    return field.problem?.(typed, values)
  }

  private static titleOf(setup: EngineSetup, field: SetupField, values: SetupValues): string {
    const fields = setup.fields.filter((each) => SetupSteps.visible(each, values))
    return `${setup.title}: ${field.title} (${fields.indexOf(field) + 1}/${fields.length})`
  }

  private static shown(field: SetupField, value: string): string {
    const choice = field.choices?.find((each) => each.value === value)
    if (choice !== undefined) {
      return choice.label
    }
    if (value === "") {
      return "none"
    }
    return field.password === true ? HIDDEN : value
  }

  private static visible(field: SetupField, values: SetupValues): boolean {
    return field.when?.(values) ?? true
  }
}
