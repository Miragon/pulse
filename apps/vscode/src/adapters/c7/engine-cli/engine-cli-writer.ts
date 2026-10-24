import { WriteCommands } from './commands/write-commands.js';
import type { EngineWriter } from './engine-writer.js';
import { EngineCliRunner, type EngineCliRunnerOptions } from './running/engine-cli-runner.js';
import { BatchViewParser } from './views/batch-view-parser.js';
import { RetryViewParser } from './views/retry-view-parser.js';
import type { BatchRef, RetryView } from './views/views.js';

export class EngineCliWriter implements EngineWriter {
  constructor(private readonly runner: EngineCliRunner) {}

  static create(options: EngineCliRunnerOptions): EngineCliWriter {
    return new EngineCliWriter(EngineCliRunner.create(options, 'write'));
  }

  async retryIncident(incidentId: string): Promise<RetryView> {
    return RetryViewParser.retry(await this.runner.json(WriteCommands.retryIncident(incidentId)));
  }

  async setVariable(instanceId: string, name: string, body: string): Promise<void> {
    await this.runner.text(WriteCommands.setVariable(instanceId, name), body);
  }

  async modify(instanceId: string, body: string): Promise<void> {
    await this.runner.text(WriteCommands.modify(instanceId), body);
  }

  async deleteInstancesAsync(body: string): Promise<BatchRef> {
    return BatchViewParser.reference(
      await this.runner.json(WriteCommands.deleteInstancesAsync(), body),
    );
  }

  async migrateInstancesAsync(body: string): Promise<BatchRef> {
    return BatchViewParser.reference(
      await this.runner.json(WriteCommands.migrateInstancesAsync(), body),
    );
  }

  async suspendBatch(batchId: string): Promise<void> {
    await this.runner.text(WriteCommands.suspendBatch(batchId));
  }

  async deleteBatch(batchId: string): Promise<void> {
    await this.runner.text(WriteCommands.deleteBatch(batchId));
  }
}
