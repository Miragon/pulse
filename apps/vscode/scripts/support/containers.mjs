import { execFileSync } from 'node:child_process';

export function containerTool() {
  for (const tool of ['podman', 'docker']) {
    try {
      execFileSync(tool, ['--version'], { stdio: 'ignore' });
      return tool;
    } catch {
      continue;
    }
  }
  throw new Error('Neither podman nor docker is installed.');
}

export function removeContainer(name) {
  execFileSync(containerTool(), ['rm', '-f', name], { stdio: 'ignore' });
}

export function startContainer({ name, image, port, environment = {} }) {
  removeContainer(name);
  const variables = Object.entries(environment).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`,
  ]);
  execFileSync(
    containerTool(),
    ['run', '-d', '--name', name, '-p', `${port}:8080`, ...variables, image],
    { stdio: 'ignore' },
  );
}

export async function waitUntil(check, what, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check().catch(() => false))) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
