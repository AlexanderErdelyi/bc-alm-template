import * as vscode from 'vscode';
import { LOCK_FILE } from './core/lock';
import { needsMigration } from './core/layout';
import { registerCommands } from './ui/commands';
import { CustomizationDiagnostics, TEMPLATE_SCHEME, TemplateContentProvider } from './ui/diagnostics';
import { ProjectState } from './ui/projectState';
import { ComponentsTree, GuidanceTree, SourcesTree } from './ui/trees';

const BASELINE_PROMPT_KEY = 'bcAlm.baselinePromptDismissed';
const MIGRATE_PROMPT_KEY = 'bcAlm.migratePromptDismissed';

export async function activate(ext: vscode.ExtensionContext): Promise<void> {
    const log = vscode.window.createOutputChannel('BC ALM');
    const state = new ProjectState(ext.globalStorageUri.fsPath);
    const content = new TemplateContentProvider();
    const diagnostics = new CustomizationDiagnostics(state);
    const bestPractices = vscode.Uri.joinPath(ext.extensionUri, 'guidance', 'best-practices.md');
    const guidance = new GuidanceTree(state, () => diagnostics.findings, bestPractices);
    const components = new ComponentsTree(state);

    ext.subscriptions.push(
        log, state, diagnostics,
        vscode.workspace.registerTextDocumentContentProvider(TEMPLATE_SCHEME, content),
        vscode.languages.registerCodeActionsProvider({ language: 'markdown' }, diagnostics, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
        vscode.window.createTreeView('bcAlm.components', { treeDataProvider: components, showCollapseAll: true }),
        vscode.window.createTreeView('bcAlm.sources', { treeDataProvider: new SourcesTree(state) }),
        vscode.window.createTreeView('bcAlm.guidance', { treeDataProvider: guidance }),
        diagnostics.onDidChange(() => guidance.refresh())
    );

    registerCommands({ ext, state, log, content, diagnostics, guidance });

    // Live validation of customization files.
    ext.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(d => diagnostics.validateDocument(d)),
        vscode.workspace.onDidChangeTextDocument(e => diagnostics.schedule(e.document)),
        vscode.workspace.onDidSaveTextDocument(d => diagnostics.validateDocument(d)),
        vscode.workspace.onDidCloseTextDocument(d => { if (d.isUntitled) { diagnostics.collection.delete(d.uri); } }),
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('bcAlm.validation')) { diagnostics.validateAll(); }
            if (e.affectsConfiguration('bcAlm.templateSources')) { void state.refresh(false); }
            if (e.affectsConfiguration('bcAlm.whatsNew')) { void guidance.loadNews(); }
        })
    );

    // Status bar: pending template updates.
    const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    ext.subscriptions.push(bar);
    const updateBar = () => {
        if (!state.root || !state.status) { bar.hide(); return; }
        const c = state.counts();
        if (state.loading) {
            bar.text = '$(sync~spin) BC ALM';
            bar.tooltip = 'Checking template sources…';
        } else if (c.updates || c.conflicts) {
            bar.text = `$(cloud-download) BC ALM ${c.updates}${c.conflicts ? ` $(warning) ${c.conflicts}` : ''}`;
            bar.tooltip = `${c.updates} component update(s)${c.conflicts ? `, ${c.conflicts} need a merge` : ''} from the template. Click to review.`;
        } else {
            bar.text = '$(check) BC ALM';
            bar.tooltip = 'Template components are up to date.';
        }
        bar.command = c.updates || c.conflicts ? 'bcAlm.updateAll' : 'bcAlm.components.focus';
        bar.backgroundColor = c.conflicts ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
        bar.show();
    };

    let baselineAsked = false;
    let migrationAsked = false;
    ext.subscriptions.push(state.onDidChange(async () => {
        updateBar();
        if (!state.loading && !migrationAsked && state.root && needsMigration(state.root) && !ext.workspaceState.get<boolean>(MIGRATE_PROMPT_KEY)) {
            migrationAsked = true;
            const a = await vscode.window.showInformationMessage(
                'BC ALM: move this project\'s template files (template.config.json, template.lock.json, scripts/*.ps1, PROJECT.md) into a single .bc-alm/ folder? References in unmodified docs and the sync workflow are updated too.',
                'Move to .bc-alm/', 'Not Now', "Don't Ask Again");
            if (a === 'Move to .bc-alm/') { await vscode.commands.executeCommand('bcAlm.migrateLayout'); }
            if (a === "Don't Ask Again") { await ext.workspaceState.update(MIGRATE_PROMPT_KEY, true); }
            return;
        }
        if (state.loading || baselineAsked || !state.status?.noLock || !state.catalogs.length) { return; }
        if (ext.workspaceState.get<boolean>(BASELINE_PROMPT_KEY)) { return; }
        baselineAsked = true;
        const a = await vscode.window.showInformationMessage(
            'BC ALM: this project has no template.lock.json yet. Record which template version your agents, skills and prompts came from, so updates can be merged safely instead of overwriting your changes?',
            'Record Baseline', 'Not Now', "Don't Ask Again");
        if (a === 'Record Baseline') { await vscode.commands.executeCommand('bcAlm.adoptBaseline'); }
        if (a === "Don't Ask Again") { await ext.workspaceState.update(BASELINE_PROMPT_KEY, true); }
    }));

    // Refresh when the project definition or lock changes (git pull, branch switch, script runs).
    const debounce = (() => {
        let t: NodeJS.Timeout | undefined;
        return () => { clearTimeout(t); t = setTimeout(() => void state.refresh(false), 500); };
    })();
    for (const glob of ['**/template.config.json', `**/${LOCK_FILE}`]) {
        const w = vscode.workspace.createFileSystemWatcher(glob);
        w.onDidChange(debounce); w.onDidCreate(debounce); w.onDidDelete(debounce);
        ext.subscriptions.push(w);
    }
    ext.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(debounce));

    const fetchOnStart = vscode.workspace.getConfiguration('bcAlm').get<boolean>('checkForUpdatesOnStartup', true);
    await vscode.commands.executeCommand('setContext', 'bcAlm.hasProject', false);
    void state.refresh(false, !fetchOnStart).then(() => {
        if (state.lastError) { log.appendLine(`[refresh] ${state.lastError}`); }
        diagnostics.validateAll();
    });
    vscode.workspace.textDocuments.forEach(d => diagnostics.validateDocument(d));
}

export function deactivate(): void { /* disposables handle cleanup */ }
