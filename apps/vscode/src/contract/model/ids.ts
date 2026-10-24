declare const opaque: unique symbol;

type Opaque<Name extends string> = string & { readonly [opaque]: Name };

export type BpmnProcessId = Opaque<'BpmnProcessId'>;
export type DefinitionId = Opaque<'DefinitionId'>;
export type InstanceId = Opaque<'InstanceId'>;
export type IncidentId = Opaque<'IncidentId'>;
export type ElementId = Opaque<'ElementId'>;
export type IsoTimestamp = Opaque<'IsoTimestamp'>;
export type PageCursor = Opaque<'PageCursor'>;
export type BulkOperationId = Opaque<'BulkOperationId'>;

export const BpmnProcessId = (value: string): BpmnProcessId => value as BpmnProcessId;
export const DefinitionId = (value: string): DefinitionId => value as DefinitionId;
export const InstanceId = (value: string): InstanceId => value as InstanceId;
export const IncidentId = (value: string): IncidentId => value as IncidentId;
export const ElementId = (value: string): ElementId => value as ElementId;
export const PageCursor = (value: string): PageCursor => value as PageCursor;
export const BulkOperationId = (value: string): BulkOperationId => value as BulkOperationId;

export function IsoTimestamp(value: string): IsoTimestamp {
  const epochMillis = Date.parse(value);
  if (Number.isNaN(epochMillis)) {
    throw new RangeError(`"${value}" is not a timestamp`);
  }
  return new Date(epochMillis).toISOString() as IsoTimestamp;
}
