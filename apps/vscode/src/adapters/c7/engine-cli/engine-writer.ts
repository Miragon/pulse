import type { BatchRef, RetryView } from "./views/views.js"

export interface EngineWriter {
  retryIncident(incidentId: string): Promise<RetryView>
  setVariable(instanceId: string, name: string, body: string): Promise<void>
  modify(instanceId: string, body: string): Promise<void>
  deleteInstancesAsync(body: string): Promise<BatchRef>
  migrateInstancesAsync(body: string): Promise<BatchRef>
  suspendBatch(batchId: string): Promise<void>
  deleteBatch(batchId: string): Promise<void>
}
