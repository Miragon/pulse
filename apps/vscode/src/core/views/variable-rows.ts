import type { InstanceDetail, ValueKind, Variable } from '../../contract/index.js';
import type { VariableEditor, VariableRow } from '../protocol/index.js';

const EDITORS: Readonly<Partial<Record<ValueKind, VariableEditor>>> = {
  string: 'text',
  integer: 'integer',
  decimal: 'decimal',
  boolean: 'boolean',
  date: 'date',
  json: 'json',
  null: 'any',
};

export class VariableRows {
  private readonly editable: boolean;

  constructor(
    private readonly detail: InstanceDetail,
    writable: boolean,
  ) {
    this.editable = writable && detail.instance.state === 'running';
  }

  rows(): VariableRow[] {
    return this.detail.variables.map((variable) => this.rowOf(variable));
  }

  private rowOf(variable: Variable): VariableRow {
    const editor = this.editorOf(variable);
    const shadowedAt = this.shadowsOf(variable);
    return {
      name: variable.name,
      valueJson: variable.valueJson,
      truncated: variable.truncated,
      ...(variable.type === undefined ? {} : { type: variable.type }),
      ...(variable.scope.kind === 'element' ? { scopeElementId: variable.scope.elementId } : {}),
      ...(editor === undefined ? {} : { editor }),
      ...(shadowedAt.length === 0 ? {} : { shadowedAt }),
    };
  }

  private editorOf(variable: Variable): VariableEditor | undefined {
    if (!this.editable || variable.truncated || variable.scope.kind !== 'instance') {
      return undefined;
    }
    return variable.kind === undefined ? undefined : EDITORS[variable.kind];
  }

  private shadowsOf(variable: Variable): readonly string[] {
    if (variable.scope.kind !== 'instance') {
      return [];
    }
    const failing = new Set<string>(this.detail.incidents.map((incident) => incident.elementId));
    return this.detail.variables.flatMap((other) =>
      other.name === variable.name &&
      other.scope.kind === 'element' &&
      failing.has(other.scope.elementId)
        ? [other.scope.elementId]
        : [],
    );
  }
}
