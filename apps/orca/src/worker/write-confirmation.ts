import type { BulkAnswer, BulkRequest, WriteRequest } from "@miragon/pulse-runtime-view/core"
import {
  ConfirmationPolicy,
  type Confirmation,
  type Connection,
  type WriteAudit,
  NotificationText,
  type EnvironmentSettings,
} from "@miragon/pulse-runtime-view/host-kit"
import type { PromptAnswer } from "../protocol.js"
import type { Prompts } from "./prompts.js"

const MAX_REASON_LENGTH = 500
const NO_LOGIN: Readonly<Record<string, string>> = {
  moveToken: "No login: the engine records neither who nor why.",
  migrateInstances: "No login: the engine doesn't record who migrated.",
}

type ReasonRule = "none" | "optional" | "required"

type Answer<Kind extends PromptAnswer["kind"]> = Extract<PromptAnswer, { kind: Kind }>

export class WriteConfirmation {
  constructor(
    private readonly prompts: Prompts,
    private readonly audit: WriteAudit,
    private readonly environments: () => EnvironmentSettings,
  ) {}

  async confirm(connection: Connection, request: WriteRequest): Promise<boolean> {
    const confirmation = this.confirmationOf(connection, request.action)
    const confirmed =
      confirmation === "none" || (await this.asked(connection, request, confirmation))
    this.audit.recordConfirmation(WriteConfirmation.engineOf(connection), {
      action: request.action,
      confirmation,
      confirmed,
    })
    return confirmed
  }

  async confirmBulk(connection: Connection, request: BulkRequest): Promise<BulkAnswer | undefined> {
    const confirmation = this.confirmationOf(connection, request.action)
    const typeHost = confirmation === "typeHost" ? connection.badge.host : undefined
    const takesReason = request.takesReason && confirmation !== "none"
    const answer = (await this.prompts.ask({
      kind: "bulk",
      title: NotificationText.printable(request.title),
      facts: WriteConfirmation.facts(connection, request),
      confirmLabel: request.confirmLabel,
      countPrompt: request.countPrompt,
      count: request.count,
      warning: request.warning,
      ...(typeHost === undefined ? {} : { typeHost }),
      ...(takesReason
        ? { reason: { prompt: request.reasonPrompt, required: confirmation === "typeHost" } }
        : {}),
    })) as Answer<"bulk"> | undefined
    const reason: ReasonRule = takesReason
      ? confirmation === "typeHost"
        ? "required"
        : "optional"
      : "none"
    const result = WriteConfirmation.bulkAnswerOf(answer, request.count, typeHost, reason)
    this.audit.recordConfirmation(WriteConfirmation.engineOf(connection), {
      action: request.action,
      confirmation: ConfirmationPolicy.bulkConfirmationOf(confirmation),
      confirmed: result !== undefined,
      fields: WriteConfirmation.bulkFields(request),
    })
    return result
  }

  private confirmationOf(
    connection: Connection,
    action: WriteRequest["action"] | BulkRequest["action"],
  ): Confirmation {
    return ConfirmationPolicy.confirmationFor(connection.target, this.environments(), action)
  }

  private async asked(
    connection: Connection,
    request: WriteRequest,
    confirmation: Confirmation,
  ): Promise<boolean> {
    const typeHost = confirmation === "typeHost" ? connection.badge.host : undefined
    const answer = (await this.prompts.ask({
      kind: "confirm",
      title: NotificationText.printable(request.title),
      facts: WriteConfirmation.facts(connection, request),
      confirmLabel: request.confirmLabel,
      ...(typeHost === undefined ? {} : { typeHost }),
    })) as Answer<"confirm"> | undefined
    return answer?.confirmed === true && (typeHost === undefined || answer.typedHost === typeHost)
  }

  private static bulkAnswerOf(
    answer: Answer<"bulk"> | undefined,
    count: number,
    typeHost: string | undefined,
    reason: ReasonRule,
  ): BulkAnswer | undefined {
    if (answer?.confirmed !== true || answer.typedCount !== String(count)) {
      return undefined
    }
    if (typeHost !== undefined && answer.typedHost !== typeHost) {
      return undefined
    }
    return reason === "none"
      ? {}
      : WriteConfirmation.withReason(answer.reason, reason === "required")
  }

  private static withReason(typed: string | undefined, required: boolean): BulkAnswer | undefined {
    const reason = NotificationText.printable(typed ?? "").trim()
    if ((required && reason === "") || reason.length > MAX_REASON_LENGTH) {
      return undefined
    }
    return reason === "" ? {} : { reason }
  }

  private static facts(
    connection: Connection,
    request: Pick<WriteRequest, "facts"> & { readonly action: string },
  ): readonly string[] {
    const who = connection.identity === undefined ? "" : ` · as ${connection.identity}`
    const noLogin = Object.hasOwn(NO_LOGIN, request.action) ? NO_LOGIN[request.action] : undefined
    const unrecorded = noLogin !== undefined && connection.identity === undefined ? [noLogin] : []
    return [
      ...request.facts,
      ...unrecorded,
      `Engine ${connection.target.name} · ${connection.badge.host}${who}`,
    ].map((line) => NotificationText.printable(line))
  }

  private static bulkFields(request: BulkRequest): string {
    const extra = Object.entries(request.auditFields ?? {}).map(([key, value]) => `${key}=${value}`)
    return [
      ...extra,
      `selected=${request.selected}`,
      `skipped=${request.selected - request.count}`,
      `count=${request.count}`,
    ].join(" ")
  }

  private static engineOf(connection: Connection) {
    return { target: connection.target, environment: connection.badge.environment }
  }
}
