import * as os from 'os';
import { commandExists, run } from './exec';

export interface RepoSlug { owner: string; repo: string }

export interface GhRepoInfo {
    fullName: string;
    owner: string;
    isTemplate: boolean;
    isFork: boolean;
    defaultBranch: string;
    parent?: string;
}

const cwd = () => os.tmpdir();

async function gh(args: string[], allowFailure = false) {
    return run('gh', args, { cwd: cwd(), allowFailure });
}

export async function requireGh(): Promise<void> {
    if (!(await commandExists('gh'))) { throw new Error('The GitHub CLI (gh) is required. Install it from https://cli.github.com and run "gh auth login".'); }
    const st = await gh(['auth', 'status'], true);
    if (st.code !== 0) { throw new Error('The GitHub CLI is not signed in. Run "gh auth login" in a terminal and try again.'); }
}

export async function ghLogin(): Promise<string> {
    return (await gh(['api', 'user', '--jq', '.login'])).stdout.trim();
}

/** The signed-in user followed by the organizations they belong to (possible owners for a new repo). */
export async function ghOwners(): Promise<{ login: string; orgs: string[] }> {
    const login = await ghLogin();
    const r = await gh(['api', 'user/orgs', '--paginate', '--jq', '.[].login'], true);
    const orgs = r.code === 0 ? r.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [];
    return { login, orgs };
}

export async function ghRepoInfo(slug: RepoSlug): Promise<GhRepoInfo | undefined> {
    const r = await gh(['api', `repos/${slug.owner}/${slug.repo}`, '--jq',
        '[.full_name, .owner.login, (.is_template|tostring), (.fork|tostring), .default_branch, (.parent.full_name // "")] | join("\\t")'], true);
    if (r.code !== 0) { return undefined; }
    const [fullName, owner, isTemplate, isFork, defaultBranch, parent] = r.stdout.trim().split('\t');
    return { fullName, owner, isTemplate: isTemplate === 'true', isFork: isFork === 'true', defaultBranch, parent: parent || undefined };
}

/** Existing fork of `slug` owned by `owner` (any name), as owner/name. */
export async function findFork(slug: RepoSlug, owner: string): Promise<string | undefined> {
    const who = owner.toLowerCase().replace(/"/g, '');
    const r = await gh(['api', `repos/${slug.owner}/${slug.repo}/forks`, '--paginate', '--jq',
        `.[] | select(.owner.login | ascii_downcase == "${who}") | .full_name`], true);
    if (r.code !== 0) { return undefined; }
    return r.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
}

export type ForkBlocker =
    | { kind: 'owner'; message: string }
    | { kind: 'existing'; fork: string; message: string };

/**
 * GitHub cannot fork a repository into the account that owns it, and an account/org can hold
 * only one fork of a repository. Returns why a fork into `targetOwner` is impossible, if it is.
 */
export function forkBlocker(upstream: string, upstreamOwner: string, targetOwner: string, existingFork?: string): ForkBlocker | undefined {
    if (upstreamOwner.toLowerCase() === targetOwner.toLowerCase()) {
        return { kind: 'owner', message: `${targetOwner} owns ${upstream}, and GitHub does not allow forking a repository into the account that owns it.` };
    }
    if (existingFork) {
        return { kind: 'existing', fork: existingFork, message: `${targetOwner} already has a fork of ${upstream} (${existingFork}); GitHub allows only one fork per account.` };
    }
    return undefined;
}
