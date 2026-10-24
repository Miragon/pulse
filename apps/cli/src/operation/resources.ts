/**
 * The resources of `operate deploy` (design §17.8): files and directories, directories scanned
 * recursively for BPMN, DMN and form files, each resource named so that its name does not depend
 * on which other files are deployed.
 */

import { basename, join, normalize, relative, sep } from 'node:path';
import type { MultipartBodySpec } from '../catalog/types.js';
import { usageError } from '../errors.js';
import type { FileSystem } from '../runtime.js';
import { checkResourceNames, type Resource, resourceName } from './multipart.js';

/** Files a directory scan deploys. */
const DEPLOYABLE = /\.(?:bpmn|dmn|form)$|\.bpmn20\.xml$|\.dmn11\.xml$/;

/** Directories a scan skips: dot-directories (`.git`, `.idea`) and `node_modules`. */
function skipped(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules';
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

/** The deployable files below `directory`; symlinked directories are not followed. */
async function scan(fs: FileSystem, directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory)) {
    const path = join(directory, entry.name);
    if (entry.kind === 'directory' && !skipped(entry.name)) files.push(...(await scan(fs, path)));
    if (entry.kind === 'file' && DEPLOYABLE.test(entry.name)) files.push(path);
  }
  return files;
}

async function resourcesOf(fs: FileSystem, path: string, baseDir: string | undefined) {
  const kind = await fs.kind(path);
  if (kind === 'missing') {
    throw usageError(
      `File not found: ${path}`,
      'Relative paths are resolved against the current directory.',
    );
  }
  if (kind === 'other')
    throw usageError(
      `Not a file or directory: ${path}`,
      'Pass BPMN, DMN or form files, or directories.',
    );
  if (kind === 'file')
    return [
      { file: path, name: baseDir === undefined ? basename(path) : resourceName(path, baseDir) },
    ];
  const files = (await scan(fs, path)).sort((left, right) => (posix(left) < posix(right) ? -1 : 1));
  if (files.length === 0) {
    throw usageError(
      `No BPMN, DMN or form files in ${path}`,
      'A directory deploys its *.bpmn, *.bpmn20.xml, *.dmn, *.dmn11.xml and *.form files (dot-directories and node_modules are skipped); name other files explicitly.',
    );
  }
  return files.map((file) => ({
    file,
    name: baseDir === undefined ? posix(relative(path, file)) : resourceName(file, baseDir),
  }));
}

/**
 * The resources of the paths in order (a directory's files sorted by path): a file named
 * explicitly by its basename, a scanned file by its path relative to the directory argument, or
 * every resource by its path relative to `baseDir`; a file given twice counts once (the first
 * name wins). Duplicate and reserved names are usage errors.
 */
export async function collectResources(
  fs: FileSystem,
  paths: readonly string[],
  options: { readonly baseDir?: string | undefined; readonly spec: MultipartBodySpec },
): Promise<Resource[]> {
  if (paths.length === 0) {
    throw usageError(
      'At least one file or directory is required',
      'Example: operate deploy src/main/resources, or operate deploy . for the current directory.',
    );
  }
  const resources = new Map<string, Resource>();
  for (const path of paths) {
    // a file named twice (also explicitly and inside a directory argument) is deployed once
    for (const resource of await resourcesOf(fs, path, options.baseDir)) {
      const key = normalize(resource.file);
      if (!resources.has(key)) resources.set(key, resource);
    }
  }
  checkResourceNames(options.spec, [...resources.values()]);
  return [...resources.values()];
}

/** True for resources whose process definitions the engine reports (`*.bpmn`, `*.bpmn20.xml`). */
export function isBpmn(name: string): boolean {
  return /\.bpmn$|\.bpmn20\.xml$/.test(name);
}

/** True for resources with decision definitions (`*.dmn`, `*.dmn11.xml`). */
export function isDmn(name: string): boolean {
  return /\.dmn$|\.dmn11\.xml$/.test(name);
}

/** A process element (`<bpmn:process ...>`, any or no namespace prefix) and its attributes. */
const PROCESS_ELEMENT = /<(?:[\w.-]+:)?process\b([^>]*)>/g;
const ID_ATTRIBUTE = /(?:^|\s)id\s*=\s*(["'])(.*?)\1/;
const NOT_EXECUTABLE = /(?:^|\s)isExecutable\s*=\s*(["'])false\1/;

/**
 * The ids of the executable processes of a BPMN file, in document order: the keys its process
 * definitions get (the engine does not deploy processes with `isExecutable="false"`).
 */
export function bpmnProcessIds(xml: string): string[] {
  return [...xml.matchAll(PROCESS_ELEMENT)].flatMap((match) => {
    const attributes = match[1] ?? '';
    const id = ID_ATTRIBUTE.exec(attributes)?.[2];
    return id === undefined || id === '' || NOT_EXECUTABLE.test(attributes) ? [] : [id];
  });
}
