import * as vscode from "vscode"
import { Problems } from "../../core/index.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { CredentialStore } from "../connections/credential-store.js"
import type { EngineTarget } from "../connections/engine-target.js"
import { ProjectFileEdit } from "../connections/project-file-edit.js"
import { PulseSettings } from "../connections/pulse-settings.js"
import type { EngineSetup, SetupValues } from "../../contract/index.js"
import { SetupFields } from "../connections/setup-fields.js"
import { TargetPolicy } from "../connections/target-policy.js"
import { TargetsFile } from "../connections/targets-file.js"
import { TargetsParser } from "../connections/targets-parser.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"
import type { OpenTargetsFileCommand } from "./open-targets-file-command.js"
import type { Prompts } from "./prompts.js"
import { SetupSteps } from "./setup-steps.js"

const CHANGE = "Change the details"
const OPEN_FILE = "Open the project file"
const NO_CREDENTIALS = { kind: "none" } as const
const CLASSES: ReadonlySet<string> = new Set(["test", "production"])

interface Draft {
  readonly folder: vscode.Uri
  readonly setup: EngineSetup
  readonly values: SetupValues
  readonly written?: string
}

interface Prepared {
  readonly file: vscode.Uri
  readonly text: string
  readonly target: EngineTarget
}

export class AddEngineCommand implements Command {
  readonly id = COMMAND.addEngine

  private readonly steps: SetupSteps

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly store: Pick<CredentialStore, "write">,
    private readonly projectFile: Pick<OpenTargetsFileCommand, "run">,
    private readonly prompts: Prompts,
  ) {
    this.steps = new SetupSteps(prompts)
  }

  async run(): Promise<void> {
    const folder = await this.folder()
    const choice =
      folder === undefined
        ? undefined
        : await this.prompts.pick(
            "Add Engine",
            this.registry
              .catalogue()
              .choices()
              .map((each) => ({ label: each.label, detail: each.detail, item: each })),
            "Which engine do you want to add?",
          )
    if (folder === undefined || choice === undefined) {
      return
    }
    if (choice.setup === undefined) {
      await this.projectFile.run()
      return
    }
    const taken = new Set(this.registry.all().map((connection) => connection.target.name))
    const setup = SetupFields.completed(choice.setup, taken)
    const values = await this.steps.ask(setup)
    if (values !== undefined) {
      await this.finish({ folder, setup, values })
    }
  }

  private async folder(): Promise<vscode.Uri | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length === 0) {
      void vscode.window.showInformationMessage(
        "Open a folder to configure engines in a .pulse-cli.json.",
      )
      return undefined
    }
    const chosen =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showWorkspaceFolderPick({
            placeHolder: `Which folder's ${TargetsFile.NAME} gets the engine?`,
            ignoreFocusOut: true,
          })
    return chosen?.uri
  }

  private async finish(draft: Draft): Promise<void> {
    const prepared = await this.prepare(draft)
    if (typeof prepared === "string") {
      await this.offerChange(draft, prepared)
      return
    }
    await this.save(draft, prepared)
    const problem = await this.check(prepared.target.name)
    if (problem !== undefined) {
      await this.offerChange({ ...draft, written: prepared.target.name }, problem)
    }
  }

  private async prepare(draft: Draft): Promise<Prepared | string> {
    const file = TargetsFile.in(draft.folder)
    const name = draft.values.name ?? ""
    const entry = { name, profile: draft.setup.profileOf(draft.values) }
    const edition = ProjectFileEdit.withProfile(await this.textOf(file), entry, draft.written)
    if ("problem" in edition) {
      return `${TargetsFile.NAME} ${edition.problem}.`
    }
    const parsed = new TargetsParser(file.fsPath, this.registry.catalogue()).parse(edition.text)
    const target = parsed.targets.find((each) => each.name === name)
    if (target === undefined) {
      const problem = parsed.problems.find((each) => each.message.startsWith(`profile "${name}"`))
      return `Pulse can't read the new profile: ${problem?.message ?? name}.`
    }
    return TargetPolicy.refusal(target, NO_CREDENTIALS) ?? { file, text: edition.text, target }
  }

  private async save(draft: Draft, prepared: Prepared): Promise<void> {
    const credentials = draft.setup.credentialsOf(draft.values)
    if (credentials !== undefined) {
      await this.store.write(prepared.target, credentials.identity, credentials.secret)
    }
    await vscode.workspace.fs.writeFile(prepared.file, new TextEncoder().encode(prepared.text))
    const environment = draft.values.environment ?? ""
    if (CLASSES.has(environment)) {
      await PulseSettings.classify(
        prepared.target.name,
        environment === "test" ? "test" : "production",
      )
    }
    await this.registry.reload()
    await this.registry.activate(prepared.target.name)
  }

  private async check(name: string): Promise<string | undefined> {
    const connection = this.registry.byName(name)
    if (connection === undefined) {
      return `Pulse doesn't read ${name}: another ${TargetsFile.NAME} may name an engine ${name} too.`
    }
    try {
      const engine = await connection.runtime.describeEngine()
      void vscode.window.showInformationMessage(
        `Pulse reads ${name}: ${engine.product} ${engine.version}.`,
      )
      await vscode.commands.executeCommand(COMMAND.openEngineOverview, name)
      return undefined
    } catch (error) {
      const problem = Problems.of(error, connection.badge)
      return `${problem.title} ${problem.detail}`
    }
  }

  private async offerChange(draft: Draft, problem: string): Promise<void> {
    const choice = await vscode.window.showErrorMessage(problem, CHANGE, OPEN_FILE)
    if (choice === OPEN_FILE) {
      await this.projectFile.run(TargetsFile.in(draft.folder).fsPath)
      return
    }
    const values =
      choice === CHANGE ? await this.steps.review(draft.setup, draft.values) : undefined
    if (values !== undefined) {
      await this.finish({ ...draft, values })
    }
  }

  private async textOf(file: vscode.Uri): Promise<string | undefined> {
    return vscode.workspace.fs.readFile(file).then(
      (bytes) => new TextDecoder().decode(bytes),
      () => undefined,
    )
  }
}
