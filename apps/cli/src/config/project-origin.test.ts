/**
 * Where the profiles of a project file come from (design §16.5): its repository, shared by all
 * worktrees that link back to it, else the project file itself. A `.git` file that only claims a
 * repository, a submodule and a symbolic link never make two repositories one.
 */

import { describe, expect, it } from 'vitest';
import { fakeRuntime } from '../../test/support/fake-runtime.js';
import { projectOrigin } from './project.js';

const LINUX = { homedir: '/home/me', platform: 'linux' };
const WINDOWS = { homedir: 'C:\\Users\\me', platform: 'win32' };

const REPO = '/home/me/repo';
const GIT = `${REPO}/.git`;
const WORKTREE = '/home/me/worktrees/feature';

/** The files `git worktree add` writes: the `.git` file and the link back to it. */
function worktreeFiles(worktree = WORKTREE, name = 'feature'): Record<string, string> {
  return {
    [`${worktree}/.git`]: `gitdir: ${GIT}/worktrees/${name}\n`,
    [`${GIT}/worktrees/${name}/gitdir`]: `${worktree}/.git\n`,
    [`${GIT}/worktrees/${name}/commondir`]: '../..\n',
  };
}

function origin(
  projectPath: string,
  files: Record<string, string> = {},
  dirs: string[] = [],
  location = LINUX,
) {
  const runtime = fakeRuntime({ files: { [projectPath]: '{}', ...files }, dirs });
  return projectOrigin(runtime.fs, projectPath, location);
}

describe('projectOrigin', () => {
  it('is the git directory of the repository, also for a project file below its root', async () => {
    await expect(origin(`${REPO}/.operate.json`, {}, [GIT])).resolves.toBe(`repository:${GIT}`);
    await expect(origin(`${REPO}/services/orders/.operate.json`, {}, [GIT])).resolves.toBe(
      `repository:${GIT}`,
    );
  });

  it('is the same for every worktree that links back to the repository', async () => {
    const files = { ...worktreeFiles(), ...worktreeFiles('/srv/agents/one', 'one') };
    await expect(origin(`${WORKTREE}/.operate.json`, files, [GIT])).resolves.toBe(
      `repository:${GIT}`,
    );
    await expect(origin('/srv/agents/one/sub/.operate.json', files, [GIT])).resolves.toBe(
      `repository:${GIT}`,
    );
  });

  it('follows relative paths in the .git file and in the link back (worktree.useRelativePaths)', async () => {
    const files = {
      [`${WORKTREE}/.git`]: 'gitdir: ../../repo/.git/worktrees/feature\n',
      [`${GIT}/worktrees/feature/gitdir`]: '../../../../worktrees/feature/.git\n',
    };
    await expect(origin(`${WORKTREE}/.operate.json`, files, [GIT])).resolves.toBe(
      `repository:${GIT}`,
    );
  });

  it('never trusts a .git file whose git directory does not link back to it', async () => {
    const project = '/home/me/download/.operate.json';
    const claims = [
      // a copied worktree: the repository links back to the real one
      {
        '/home/me/download/.git': `gitdir: ${GIT}/worktrees/feature`,
        ...worktreeFiles(),
      },
      // a git directory without a link back, or with an empty one
      { '/home/me/download/.git': `gitdir: ${GIT}/worktrees/gone` },
      {
        '/home/me/download/.git': `gitdir: ${GIT}/worktrees/empty`,
        [`${GIT}/worktrees/empty/gitdir`]: '\n',
      },
      // the repository's own git directory, not one of its worktrees
      { '/home/me/download/.git': `gitdir: ${GIT}` },
      // a fake worktree directory next to the project that names the repository as common dir
      {
        '/home/me/download/.git': 'gitdir: /home/me/download/fake/worktrees/x',
        '/home/me/download/fake/worktrees/x/gitdir': '/home/me/download/.git',
        '/home/me/download/fake/worktrees/x/commondir': GIT,
      },
      // no gitdir line at all
      { '/home/me/download/.git': 'not a git file' },
    ];
    const results = await Promise.all(claims.map((files) => origin(project, files, [GIT])));
    expect(results.slice(0, -2)).toEqual(Array(4).fill(`project:${project}`));
    // the fake worktree is a repository of its own, never the one it names
    expect(results.at(-2)).toBe('repository:/home/me/download/fake');
    expect(results.at(-1)).toBe(`project:${project}`);
  });

  it('gives a submodule its own origin, never that of the superproject', async () => {
    const files = {
      [`${REPO}/vendor/lib/.git`]: `gitdir: ${GIT}/modules/lib`,
      [`${GIT}/modules/lib/gitdir`]: `${REPO}/vendor/lib/.git`,
    };
    await expect(origin(`${REPO}/vendor/lib/.operate.json`, files, [GIT])).resolves.toBe(
      `project:${REPO}/vendor/lib/.operate.json`,
    );
  });

  it('is the project file outside a repository, below the home directory and at the root', async () => {
    await expect(origin('/home/me/scratch/.operate.json')).resolves.toBe(
      'project:/home/me/scratch/.operate.json',
    );
    // the home directory is nobody's repository
    await expect(origin('/home/me/scratch/.operate.json', {}, ['/home/me/.git'])).resolves.toBe(
      'project:/home/me/scratch/.operate.json',
    );
    await expect(origin('/srv/app/.operate.json')).resolves.toBe('project:/srv/app/.operate.json');
  });

  it('stops at a .git that is neither a file nor a directory', async () => {
    const runtime = fakeRuntime({
      files: { [`${REPO}/.operate.json`]: '{}' },
      dirs: ['/home/me/.git'],
      others: [GIT],
    });
    await expect(projectOrigin(runtime.fs, `${REPO}/.operate.json`, LINUX)).resolves.toBe(
      `project:${REPO}/.operate.json`,
    );
  });

  it("never takes another user's .git, nor one in a file system root (like git's safe.directory)", async () => {
    const project = '/tmp/evil/.operate.json';
    const foreign = fakeRuntime({
      files: { [project]: '{}' },
      dirs: ['/tmp/.git'],
      foreign: ['/tmp/.git'],
    });
    await expect(projectOrigin(foreign.fs, project, LINUX)).resolves.toBe(`project:${project}`);
    // a worktree .git file of another user does not count either
    const files = { [`${WORKTREE}/.operate.json`]: '{}', ...worktreeFiles() };
    const file = fakeRuntime({ files, dirs: [GIT], foreign: [`${WORKTREE}/.git`] });
    await expect(projectOrigin(file.fs, `${WORKTREE}/.operate.json`, LINUX)).resolves.toBe(
      `project:${WORKTREE}/.operate.json`,
    );
    const root = fakeRuntime({ files: { '/srv/.operate.json': '{}' }, dirs: ['/.git'] });
    await expect(projectOrigin(root.fs, '/srv/.operate.json', LINUX)).resolves.toBe(
      'project:/srv/.operate.json',
    );
    const drive = fakeRuntime({
      files: { 'C:\\tmp\\evil\\.operate.json': '{}' },
      dirs: ['C:\\.git'],
      noOwners: true,
    });
    await expect(projectOrigin(drive.fs, 'C:\\tmp\\evil\\.operate.json', WINDOWS)).resolves.toBe(
      'project:c:\\tmp\\evil\\.operate.json',
    );
  });

  it('takes any .git below the root where the platform has no owners', async () => {
    const runtime = fakeRuntime({
      files: { [`${REPO}/.operate.json`]: '{}' },
      dirs: [GIT],
      noOwners: true,
    });
    await expect(projectOrigin(runtime.fs, `${REPO}/.operate.json`, LINUX)).resolves.toBe(
      `repository:${GIT}`,
    );
  });

  it('compares Windows paths without case', async () => {
    const runtime = fakeRuntime({
      files: {
        'C:\\work\\repo\\.operate.json': '{}',
        'D:\\wt\\x\\.operate.json': '{}',
        'D:\\wt\\x\\.git': 'gitdir: C:\\work\\repo\\.git\\worktrees\\x',
        'C:\\work\\repo\\.git\\worktrees\\x\\gitdir': 'd:\\WT\\x\\.git',
      },
      dirs: ['C:\\work\\repo\\.git'],
    });
    const main = await projectOrigin(runtime.fs, 'C:\\work\\repo\\.operate.json', WINDOWS);
    expect(main).toBe('repository:c:\\work\\repo\\.git');
    await expect(projectOrigin(runtime.fs, 'D:\\wt\\x\\.operate.json', WINDOWS)).resolves.toBe(
      main,
    );
  });
});
