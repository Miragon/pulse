import type { BpmnProcessId } from './ids.js';

export interface SourceLocation {
  readonly uri: string;
  readonly line: number;
}

export interface ModelFile {
  readonly uri: string;
  readonly fileName: string;
  readonly bpmnProcessId: BpmnProcessId;
  readonly xml: string;
}

export type ElementImplementation =
  | { readonly kind: 'workerTask'; readonly taskType: string }
  | { readonly kind: 'class'; readonly className: string }
  | { readonly kind: 'delegate'; readonly expression: string }
  | { readonly kind: 'expression'; readonly expression: string };

export interface VariableMapping {
  readonly target: string;
  readonly source?: string;
}

export interface ErrorReference {
  readonly code?: string;
  readonly name?: string;
}

export interface ElementConfiguration {
  readonly implementation?: ElementImplementation;
  readonly inputs: readonly VariableMapping[];
  readonly outputs: readonly VariableMapping[];
  readonly errors: readonly ErrorReference[];
}

export interface ModelElement {
  readonly location: SourceLocation;
  readonly configuration: ElementConfiguration;
}
