/**
 * Builds multipart bodies: string and boolean fields from flags, binary fields and deployment
 * resources from files read through the injected file system.
 */

import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { MultipartBodySpec, MultipartField } from '../catalog/types.js';
import { usageError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import { type CommandValues, lastString, scalarFlag } from './command-values.js';
import { readInputFile } from './files.js';
import type { MultipartFile, OperationInput } from './request.js';

type Flags = CommandValues['flags'];
type Multipart = NonNullable<OperationInput['multipart']>;

const RESOURCE_HINT =
  'Example: operate deployment create order.bpmn approval.dmn --deployment-name orders';

/**
 * Name of a deployment resource: the file name, or the posix path relative to `baseDir`.
 * Files outside `baseDir` are rejected.
 */
export function resourceName(file: string, baseDir: string | undefined): string {
  if (baseDir === undefined) return basename(file);
  const path = relative(resolve(baseDir), resolve(file));
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw usageError(
      `File ${file} is not inside --base-dir ${baseDir}`,
      'Pass files below the base directory, or omit --base-dir to name resources by file name.',
    );
  }
  return path.split(sep).join('/');
}

async function readPart(fs: FileSystem, path: string, field: string, fileName: string) {
  const data = await readInputFile(fs, path);
  return { field, fileName, data: new Blob([data]) } satisfies MultipartFile;
}

function fieldText(field: MultipartField, value: NonNullable<Flags[string]>): string {
  return String(scalarFlag(field, value, `--${field.flag}`));
}

function textFields(spec: MultipartBodySpec, flags: Flags): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of spec.fields) {
    const value = flags[field.flag];
    if (field.type !== 'binary' && value !== undefined)
      fields[field.name] = fieldText(field, value);
  }
  return fields;
}

function binaryFields(spec: MultipartBodySpec, flags: Flags, fs: FileSystem) {
  return spec.fields.flatMap((field) => {
    const value = flags[field.flag];
    if (field.type !== 'binary' || value === undefined) return [];
    const path = lastString(value);
    return [readPart(fs, path, field.name, basename(path))];
  });
}

/** A deployment resource: the file to read and the resource name it is deployed under. */
export interface Resource {
  readonly file: string;
  readonly name: string;
}

/**
 * The engine keys parts by name and reads its settings (`deployment-name`, `tenant-id`, ...) from
 * parts of the same names, so a resource with such a name would turn into a setting.
 */
function checkNotField(spec: MultipartBodySpec, name: string, file: string): void {
  const field = spec.fields.find((candidate) => candidate.name === name);
  if (field === undefined) return;
  throw usageError(
    `Resource name "${name}" of ${file} is reserved for the form field --${field.flag}`,
    'Rename the file, or use --base-dir to name it by its path relative to a directory.',
  );
}

/**
 * Resource names must be unique and must not be the name of a form field of the deployment
 * (shared by `deployment create` and `operate deploy`).
 */
export function checkResourceNames(spec: MultipartBodySpec, resources: readonly Resource[]): void {
  const seen = new Map<string, string>();
  for (const { file, name } of resources) {
    checkNotField(spec, name, file);
    const previous = seen.get(name);
    if (previous !== undefined) {
      throw usageError(
        `Duplicate resource name "${name}" (${previous} and ${file})`,
        'Use --base-dir to name resources by their path relative to a directory.',
      );
    }
    seen.set(name, file);
  }
}

function resources(
  spec: MultipartBodySpec,
  files: readonly string[],
  baseDir: string | undefined,
): Resource[] {
  if (files.length === 0) throw usageError('At least one resource file is required', RESOURCE_HINT);
  const named = files.map((file) => ({ file, name: resourceName(file, baseDir) }));
  checkResourceNames(spec, named);
  return named;
}

function resourceParts(
  spec: MultipartBodySpec,
  files: readonly string[],
  flags: Flags,
  fs: FileSystem,
) {
  const baseDir = flags['base-dir'] === undefined ? undefined : lastString(flags['base-dir']);
  return resources(spec, files, baseDir).map(({ file, name }) => readPart(fs, file, name, name));
}

export async function buildMultipart(
  spec: MultipartBodySpec,
  files: readonly string[],
  flags: Flags,
  fs: FileSystem,
): Promise<Multipart> {
  const fields = textFields(spec, flags);
  const resources = spec.resources ? resourceParts(spec, files, flags, fs) : [];
  const parts = await Promise.all([...binaryFields(spec, flags, fs), ...resources]);
  return { fields, files: parts };
}
