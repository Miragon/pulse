export interface EngineCliFailureDetails {
  readonly code: string
  readonly exitCode: number | null
  readonly status?: number
  readonly engineType?: string
  readonly hint?: string
}

const ROUTE_NOT_FOUND = "NotFoundException"
const RESOURCE_GONE = "NullValueException"

export class EngineCliFailure extends Error {
  override readonly name = "EngineCliFailure"
  readonly code: string
  readonly exitCode: number | null
  readonly status: number | undefined
  readonly engineType: string | undefined
  readonly hint: string | undefined

  constructor(message: string, details: EngineCliFailureDetails) {
    super(message)
    this.code = details.code
    this.exitCode = details.exitCode
    this.status = details.status
    this.engineType = details.engineType
    this.hint = details.hint
  }

  static isMissingResource(error: unknown): boolean {
    return error instanceof EngineCliFailure && (error.isEngineNotFound() || error.isResourceGone())
  }

  private isEngineNotFound(): boolean {
    if (this.code !== "NOT_FOUND") {
      return false
    }
    const reportedByCli = this.status === undefined
    const reportedByEngine = this.engineType !== undefined && this.engineType !== ROUTE_NOT_FOUND
    return reportedByCli || reportedByEngine
  }

  private isResourceGone(): boolean {
    return this.status === 500 && this.engineType === RESOURCE_GONE
  }
}
