import type { BulkAnswer, BulkRequest, WriteRequest } from '../../core/index.js';
import { ConfirmationPolicy } from '../connections/confirmation-policy.js';
import type { Connection } from '../connections/connection.js';
import { PulseSettings } from '../connections/pulse-settings.js';
import type { WriteAudit } from '../connections/write-audit.js';
import { BulkDialog } from './bulk-dialog.js';
import { WriteDialog, type WriteTargetEngine } from './write-dialog.js';

const ENVIRONMENT_LABELS = {
  local: 'LOCAL',
  test: 'TEST',
  production: 'PRODUCTION',
  unclassified: 'unclassified',
} as const;

export class WriteConfirmation {
  constructor(private readonly audit: WriteAudit) {}

  async confirm(connection: Connection, request: WriteRequest): Promise<boolean> {
    const confirmation = ConfirmationPolicy.confirmationFor(
      connection.target,
      PulseSettings.environments(),
      request.action,
    );
    const confirmed = await new WriteDialog(request, this.engineOf(connection)).confirm(
      confirmation,
    );
    this.audit.recordConfirmation(
      { target: connection.target, environment: connection.badge.environment },
      { action: request.action, confirmation, confirmed },
    );
    return confirmed;
  }

  async confirmBulk(connection: Connection, request: BulkRequest): Promise<BulkAnswer | undefined> {
    const confirmation = ConfirmationPolicy.confirmationFor(
      connection.target,
      PulseSettings.environments(),
      request.action,
    );
    const answer = await new BulkDialog(request, this.engineOf(connection)).confirm(confirmation);
    this.audit.recordConfirmation(
      { target: connection.target, environment: connection.badge.environment },
      {
        action: request.action,
        confirmation: ConfirmationPolicy.bulkConfirmationOf(confirmation),
        confirmed: answer !== undefined,
        fields: this.bulkFields(request),
      },
    );
    return answer;
  }

  private bulkFields(request: BulkRequest): string {
    const extra = Object.entries(request.auditFields ?? {}).map(
      ([key, value]) => `${key}=${value}`,
    );
    return [
      ...extra,
      `selected=${request.selected}`,
      `skipped=${request.selected - request.count}`,
      `count=${request.count}`,
    ].join(' ');
  }

  private engineOf(connection: Connection): WriteTargetEngine {
    return {
      name: connection.target.name,
      environment: ENVIRONMENT_LABELS[connection.badge.environment],
      host: connection.badge.host,
      ...(connection.identity === undefined ? {} : { identity: connection.identity }),
    };
  }
}
