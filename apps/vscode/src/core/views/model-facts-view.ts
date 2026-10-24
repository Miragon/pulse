import type {
  ModelFile,
  ElementConfiguration,
  ElementImplementation,
  ErrorReference,
  VariableMapping,
} from '../../contract/index.js';
import type { ElementLink } from '../panels/model-links.js';
import { ModelXml } from '../drift/model-xml.js';
import type { DefinitionView, ModelFacts, ModelSetting } from '../protocol/index.js';

const IMPLEMENTATION_LABELS: Readonly<Record<ElementImplementation['kind'], string>> = {
  workerTask: 'Task type',
  class: 'Class',
  delegate: 'Delegate',
  expression: 'Expression',
};

export class ModelFactsView {
  static of(link: ElementLink, jobType?: string): ModelFacts {
    const configuration = link.element?.configuration;
    return {
      fileName: link.model.fileName,
      settings:
        configuration === undefined ? [] : ModelFactsView.settingsOf(configuration, jobType),
      ...(link.differsFromDeployed ? { differsFromDeployed: true as const } : {}),
      ...(link.code === undefined ? {} : { codeLabel: ModelFactsView.fileNameOf(link.code.uri) }),
    };
  }

  static fileOf(
    model: ModelFile,
    deployedXml: string,
    link: ElementLink | undefined,
  ): NonNullable<DefinitionView['model']> {
    const code = link === undefined ? undefined : ModelFactsView.codeOf(link);
    return {
      fileName: model.fileName,
      ...(ModelXml.same(model.xml, deployedXml) ? {} : { differsFromDeployed: true as const }),
      ...(code === undefined ? {} : { code }),
    };
  }

  static codeOf(link: ElementLink): { elementId: string; label: string } | undefined {
    return link.code === undefined
      ? undefined
      : { elementId: link.elementId, label: ModelFactsView.fileNameOf(link.code.uri) };
  }

  private static settingsOf(
    configuration: ElementConfiguration,
    jobType: string | undefined,
  ): ModelSetting[] {
    const implementation = configuration.implementation;
    const shown =
      implementation !== undefined && !ModelFactsView.isJobType(implementation, jobType);
    return [
      ...(shown ? [ModelFactsView.implementationOf(implementation)] : []),
      ...configuration.inputs.map((mapping) => ModelFactsView.mappingOf('Input', mapping)),
      ...configuration.outputs.map((mapping) => ModelFactsView.mappingOf('Output', mapping)),
      ...configuration.errors.map((error) => ({
        label: 'Error',
        value: ModelFactsView.errorOf(error),
      })),
    ];
  }

  private static implementationOf(implementation: ElementImplementation): ModelSetting {
    const label = IMPLEMENTATION_LABELS[implementation.kind];
    switch (implementation.kind) {
      case 'workerTask':
        return { label, value: implementation.taskType };
      case 'class':
        return { label, value: implementation.className };
      case 'delegate':
      case 'expression':
        return { label, value: implementation.expression };
    }
  }

  private static isJobType(implementation: ElementImplementation, jobType: string | undefined) {
    return implementation.kind === 'workerTask' && implementation.taskType === jobType;
  }

  private static mappingOf(label: string, mapping: VariableMapping): ModelSetting {
    return {
      label,
      value:
        mapping.source === undefined ? mapping.target : `${mapping.target} ← ${mapping.source}`,
    };
  }

  private static errorOf(error: ErrorReference): string {
    if (error.code !== undefined && error.name !== undefined && error.code !== error.name) {
      return `${error.code} (${error.name})`;
    }
    return error.code ?? error.name ?? '';
  }

  private static fileNameOf(uri: string): string {
    return decodeURIComponent(uri.slice(uri.lastIndexOf('/') + 1));
  }
}
