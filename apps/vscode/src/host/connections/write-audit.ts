import { RuntimeError } from '../../contract/index.js';
import type { BulkOutcomeReport } from '../../core/index.js';
import type { Environment } from '../../core/protocol/index.js';
import type { EngineTarget } from './engine-target.js';

export interface AuditLog {
  info(message: string): void;
}

export interface AuditedEngine {
  readonly target: EngineTarget;
  readonly environment: Environment;
}

export interface AuditedWrite<Result> {
  readonly operation: string;
  readonly fields: string;
  run(): Promise<Result>;
  resultFields?(result: Result): string;
}

export interface ConfirmationAnswer {
  readonly action: string;
  readonly confirmation: string;
  readonly confirmed: boolean;
  readonly fields?: string;
}

const IDS_PER_LINE = 100;

export class WriteAudit {
  constructor(private readonly log: AuditLog) {}

  async recordWrite<Result>(engine: AuditedEngine, write: AuditedWrite<Result>): Promise<Result> {
    const line = `${write.operation} ${this.engineFields(engine)} ${write.fields}`;
    try {
      const result = await write.run();
      const extra = write.resultFields?.(result);
      this.log.info(`${line} result=done${extra === undefined ? '' : ` ${extra}`}`);
      return result;
    } catch (error) {
      this.log.info(`${line} result=${this.resultOf(error)}`);
      throw error;
    }
  }

  recordConfirmation(engine: AuditedEngine, answer: ConfirmationAnswer): void {
    const fields = answer.fields === undefined ? '' : ` ${answer.fields}`;
    this.log.info(
      `confirm ${answer.action} ${this.engineFields(engine)} confirmation=${answer.confirmation} answer=${answer.confirmed ? 'confirmed' : 'cancelled'}${fields}`,
    );
  }

  recordOutcome(engine: AuditedEngine, report: BulkOutcomeReport): void {
    this.log.info(
      `${report.action}Outcome ${this.engineFields(engine)} bulk=${report.operationId} phase=${report.phase} ${this.outcomeFields(report)}`,
    );
  }

  recordIds(engine: AuditedEngine, operation: string, ids: readonly string[]): void {
    this.recordParts(engine, operation, 'ids', ids);
  }

  recordParts(
    engine: AuditedEngine,
    operation: string,
    field: string,
    values: readonly string[],
  ): void {
    const parts = Math.ceil(values.length / IDS_PER_LINE);
    for (let part = 0; part < parts; part += 1) {
      const chunk = values.slice(part * IDS_PER_LINE, (part + 1) * IDS_PER_LINE);
      this.log.info(
        `${operation} ${this.engineFields(engine)} part=${part + 1}/${parts} ${field}=${chunk.join(',')}`,
      );
    }
  }

  private outcomeFields(report: BulkOutcomeReport): string {
    if (report.arrived === undefined) {
      return `done=${report.total - report.remaining} remaining=${report.remaining}`;
    }
    const ended = Math.max(0, report.total - report.arrived - report.remaining);
    return `migrated=${report.arrived} stillOnSource=${report.remaining} ended=${ended} failed=${report.failed}`;
  }

  private engineFields({ target, environment }: AuditedEngine): string {
    return `engine=${target.name} origin=${new URL(target.endpoint).origin} environment=${environment}`;
  }

  private resultOf(error: unknown): string {
    return RuntimeError.is(error) ? error.failure : 'error';
  }
}
