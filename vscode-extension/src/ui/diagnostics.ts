import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { customScanRoots } from '../core/paths';
import { applyFix, customizationKind, Finding, QuickFix, validateFile } from '../core/validator';
import { joinRel, listFilesRecursive, toPosix } from '../core/util';
import { ProjectState } from './projectState';

export const TEMPLATE_SCHEME = 'bcalm-template';

/** Read-only virtual documents (template versions) for diffs and previews. */
export class TemplateContentProvider implements vscode.TextDocumentContentProvider {
    private readonly docs = new Map<string, string>();
    private seq = 0;
    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.docs.get(uri.path.split('/')[1]) ?? '';
    }
    uri(text: string, fileName: string, label: string): vscode.Uri {
        const key = `${++this.seq}`;
        this.docs.set(key, text);
        if (this.docs.size > 200) { this.docs.delete(this.docs.keys().next().value!); }
        return vscode.Uri.from({ scheme: TEMPLATE_SCHEME, path: `/${key}/${fileName}`, query: label });
    }
}

function fixKey(uri: vscode.Uri, line: number, message: string): string {
    return `${uri.toString()}#${line}#${message}`;
}

const SEVERITY: Record<Finding['severity'], vscode.DiagnosticSeverity> = {
    error: vscode.DiagnosticSeverity.Error,
    warning: vscode.DiagnosticSeverity.Warning,
    info: vscode.DiagnosticSeverity.Information
};

/** Live validation of agents / skills / prompts / instructions against current Copilot guidance. */
export class CustomizationDiagnostics implements vscode.CodeActionProvider, vscode.Disposable {
    readonly collection = vscode.languages.createDiagnosticCollection('bc-alm');
    readonly findings = new Map<string, Finding[]>();
    private readonly fixes = new Map<string, QuickFix>();
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    private timers = new Map<string, NodeJS.Timeout>();

    constructor(private readonly state: ProjectState) { }

    dispose(): void {
        this.collection.dispose();
        this.emitter.dispose();
        this.timers.forEach(t => clearTimeout(t));
    }

    private enabled(): boolean {
        return vscode.workspace.getConfiguration('bcAlm').get<boolean>('validation.enabled', true);
    }

    private root(uri: vscode.Uri): string | undefined {
        return this.state.root ?? vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    }

    private knownAgents(root: string): Set<string> {
        const names = new Set<string>();
        const roots = this.state.project ? customScanRoots(this.state.project.sync).filter(r => r.endsWith('agents')) : ['.github/agents'];
        for (const r of roots) {
            for (const f of listFilesRecursive(path.join(root, ...r.split('/')))) {
                const m = /^([^/]+)\.(agent|chatmode)\.md$/.exec(f);
                if (m) { names.add(m[1]); }
            }
        }
        return names;
    }

    validateDocument(doc: vscode.TextDocument, known?: Set<string>): void {
        if (doc.uri.scheme !== 'file' || !this.enabled()) { return; }
        const root = this.root(doc.uri);
        if (!root) { return; }
        const rel = toPosix(path.relative(root, doc.uri.fsPath));
        if (rel.startsWith('..') || rel.startsWith('.bc-alm/') || !customizationKind(rel)) { return; }
        this.set(doc.uri, rel, validateFile(rel, doc.getText(), { project: this.state.project, knownAgents: known ?? this.knownAgents(root), root }));
    }

    schedule(doc: vscode.TextDocument): void {
        const k = doc.uri.toString();
        clearTimeout(this.timers.get(k));
        this.timers.set(k, setTimeout(() => { this.timers.delete(k); this.validateDocument(doc); }, 400));
    }

    private set(uri: vscode.Uri, rel: string, findings: Finding[]): void {
        const diags = findings.map(f => {
            const line = Math.max(0, f.line);
            const d = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), f.message, SEVERITY[f.severity]);
            d.source = 'BC ALM';
            d.code = f.docUrl ? { value: f.code, target: vscode.Uri.parse(f.docUrl) } : f.code;
            if (f.fix) { this.fixes.set(fixKey(uri, line, f.message), f.fix); }
            return d;
        });
        this.collection.set(uri, diags);
        if (findings.length) { this.findings.set(rel, findings); } else { this.findings.delete(rel); }
        this.emitter.fire();
    }

    /** Validate every customization file in the project (not only open ones). */
    validateAll(): number {
        this.collection.clear();
        this.findings.clear();
        const root = this.state.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root || !this.enabled()) { this.emitter.fire(); return 0; }
        const known = this.knownAgents(root);
        const scan = this.state.project ? customScanRoots(this.state.project.sync) : ['.github/agents', '.github/skills', '.github/prompts', '.github/instructions'];
        let count = 0;
        for (const r of scan) {
            for (const f of listFilesRecursive(path.join(root, ...r.split('/')))) {
                const rel = joinRel(r, f);
                if (!customizationKind(rel)) { continue; }
                const abs = path.join(root, ...rel.split('/'));
                const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === abs);
                const text = open ? open.getText() : fs.readFileSync(abs, 'utf8');
                const fnd = validateFile(rel, text, { project: this.state.project, knownAgents: known, root });
                count += fnd.length;
                this.set(vscode.Uri.file(abs), rel, fnd);
            }
        }
        this.emitter.fire();
        return count;
    }

    provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
        const out: vscode.CodeAction[] = [];
        for (const d of ctx.diagnostics) {
            const fix = this.fixes.get(fixKey(doc.uri, d.range.start.line, d.message));
            if (!fix) { continue; }
            const a = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
            a.diagnostics = [d];
            a.isPreferred = true;
            const edit = new vscode.WorkspaceEdit();
            if (fix.kind === 'renameFile') {
                edit.renameFile(doc.uri, vscode.Uri.file(path.join(path.dirname(doc.uri.fsPath), fix.to)));
            } else {
                const text = doc.getText();
                edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), applyFix(text, fix));
            }
            a.edit = edit;
            out.push(a);
        }
        return out;
    }
}
