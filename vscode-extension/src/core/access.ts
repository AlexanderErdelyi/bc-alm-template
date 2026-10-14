import { redactSecrets } from './exec';

export type SourceErrorKind = 'access' | 'network' | 'ref' | 'other';

export interface SourceProblem {
    kind: SourceErrorKind;
    /** One actionable sentence for the views and notifications. */
    message: string;
    /** Original git / gh output, for the log. */
    detail: string;
}

function repoLabel(url: string): string {
    const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
    return m ? `${m[1]}/${m[2]}` : redactSecrets(url);
}

/**
 * Turn a git failure for a template source into an actionable message. A private repository you
 * have no access to looks like "not found" on GitHub, so both are reported as an access problem.
 */
export function classifySourceError(error: string, url: string, ref?: string): SourceProblem {
    const detail = redactSecrets(error.trim());
    // Ignore the echoed command line ("git ... failed (128): <stderr>") - match git's own output only.
    const e = detail.replace(/^[\s\S]*?failed \(-?\d+\):\s*/, '').toLowerCase();
    const label = repoLabel(url);
    const github = /github\.com/i.test(url);
    if (/needed a single revision|unknown revision|bad revision|couldn't find remote ref|remote branch .* not found/.test(e) || (/rev-parse/.test(detail) && !/fatal: (repository|authentication)/.test(e))) {
        return { kind: 'ref', detail, message: `Branch or tag "${ref ?? '?'}" does not exist in ${label}. Use "Change Branch/Tag" on the source.` };
    }
    if (/authentication failed|could not read username|terminal prompts disabled|permission denied|access denied|\b40[13]\b|not authorized|repository not found|not found|does not appear to be a git repository|could not read from remote/.test(e)) {
        return {
            kind: 'access', detail,
            message: github
                ? `No access to ${label}. Ask its owner for read access, then sign in with "gh auth login" and run "gh auth setup-git" (or sign in through Git Credential Manager).`
                : `No access to ${label}. Check the URL and your git credentials.`
        };
    }
    if (/could not resolve host|failed to connect|timed out|network is unreachable|connection (reset|refused)|ssl|unable to access/.test(e)) {
        return { kind: 'network', detail, message: `Cannot reach ${label} - offline or blocked by a proxy? The cached copy is used when there is one.` };
    }
    return { kind: 'other', detail, message: e ? detail.replace(/^[\s\S]*?failed \(-?\d+\):\s*/, '').split('\n')[0] : `Could not load ${label}.` };
}
