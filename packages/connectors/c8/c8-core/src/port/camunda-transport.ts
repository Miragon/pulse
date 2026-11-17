import type { CamundaFailure } from "./camunda-failure.js"

export interface CamundaTransport {
  get(path: string): Promise<unknown>
  post(path: string, body: unknown): Promise<unknown>
  text(path: string): Promise<string>
  failure(error: unknown): CamundaFailure | undefined
}
