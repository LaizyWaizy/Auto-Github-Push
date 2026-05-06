const path = require("node:path");
const vscode = require("vscode");
const {
  approveSensitiveFinding,
  commitAndPush,
  createGithubRepository,
  ensureGitignore,
  getGithubStatus,
  getPrivacyReview,
  getProjectStatus,
  initializeRepository,
  scanSensitiveInfo
} = require("./project-service");

function activeWorkspacePath() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a project folder in VS Code first.");
  }
  return folder.uri.fsPath;
}

function workspaceName(projectPath) {
  return path.basename(projectPath);
}

async function choosePrivacy(projectPath) {
  const review = await getPrivacyReview(projectPath);
  const picks = [];

  for (const item of review.ignoreRules) {
    picks.push({
      label: item.rule,
      description: item.present ? "Already ignored" : "Add to .gitignore",
      picked: item.selected || item.present,
      alwaysShow: true,
      kind: "ignore",
      value: item.rule
    });
  }

  for (const item of review.csvCopies) {
    picks.push({
      label: item.publicPath,
      description: `Plain CSV copy from ${item.privatePath}`,
      picked: item.selected,
      alwaysShow: true,
      kind: "csv",
      value: item.privatePath
    });
  }

  if (picks.length === 0) {
    return { ignoreRules: [], csvPrivatePaths: [] };
  }

  const selected = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    ignoreFocusOut: true,
    placeHolder: "Pick the privacy changes to apply before continuing"
  });

  if (!selected) return null;

  return {
    ignoreRules: selected.filter((item) => item.kind === "ignore").map((item) => item.value),
    csvPrivatePaths: selected.filter((item) => item.kind === "csv").map((item) => item.value)
  };
}

async function notifyResult(result, successMessage) {
  if (result?.scan?.findings?.length) {
    vscode.window.showWarningMessage(result.output || "Blocked by sensitive-info scan.");
    return;
  }
  vscode.window.showInformationMessage(successMessage || result?.output || "Done.");
}

async function commandWithWorkspace(callback) {
  try {
    await callback(activeWorkspacePath());
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
  }
}

function webviewHtml(webview, extensionUri) {
  const nonce = Date.now().toString(36);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Auto GitHub Push</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: var(--vscode-font-family); margin: 0; padding: 14px; color: var(--vscode-foreground); }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 0.95rem; margin-bottom: 8px; }
    p, small { color: var(--vscode-descriptionForeground); }
    button, input, select { font: inherit; }
    button { background: var(--vscode-button-background); border: 0; color: var(--vscode-button-foreground); cursor: pointer; min-height: 32px; padding: 0 10px; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button.danger { background: var(--vscode-errorForeground); color: var(--vscode-button-foreground); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    input, select { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); min-height: 30px; padding: 0 8px; }
    label { display: grid; gap: 5px; }
    .stack { display: grid; gap: 14px; }
    .head { display: grid; gap: 5px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    .actions { display: grid; gap: 8px; grid-template-columns: 1fr auto; }
    .action-menu { position: relative; }
    .action-menu summary { align-items: center; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; display: inline-flex; font-weight: 600; justify-content: center; list-style: none; min-height: 32px; padding: 0 10px; user-select: none; }
    .action-menu summary::-webkit-details-marker { display: none; }
    .action-menu summary::after { content: "v"; font-size: 0.9em; margin-left: 7px; }
    .action-menu[open] summary::after { content: "^"; }
    .menu-list { background: var(--vscode-menu-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border)); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.22); display: grid; gap: 6px; min-width: 170px; padding: 8px; position: absolute; right: 0; top: calc(100% + 6px); z-index: 2; }
    .menu-list button { justify-content: flex-start; width: 100%; }
    .wide { grid-column: 1 / -1; }
    .panel { border: 1px solid var(--vscode-panel-border); padding: 10px; display: grid; gap: 8px; }
    .disclosure { border: 1px solid var(--vscode-panel-border); }
    .disclosure summary { cursor: pointer; font-weight: 700; list-style-position: inside; padding: 10px; }
    .disclosure-body { display: grid; gap: 8px; padding: 0 10px 10px; }
    .status { display: grid; gap: 6px; }
    .row { display: flex; justify-content: space-between; gap: 10px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .privacy-option { align-items: flex-start; border: 1px solid var(--vscode-panel-border); display: grid; gap: 8px; grid-template-columns: auto 1fr; padding: 8px; }
    .privacy-option span { display: grid; gap: 2px; min-width: 0; }
    .privacy-option strong, .privacy-option small, .finding { overflow-wrap: anywhere; }
    .privacy-group { display: grid; gap: 6px; }
    .privacy-disclosure { border: 1px solid var(--vscode-panel-border); display: grid; gap: 6px; padding: 8px; }
    .privacy-disclosure summary { cursor: pointer; font-weight: 700; list-style-position: inside; }
    .finding { border: 1px solid var(--vscode-panel-border); padding: 8px; }
    .finding strong { color: var(--vscode-errorForeground); display: block; }
    .form { display: grid; gap: 8px; }
  </style>
</head>
<body>
  <main class="stack">
    <section class="head">
      <h1>Auto GitHub Push</h1>
      <p id="workspace">Loading workspace...</p>
    </section>

    <section class="actions" aria-label="Project actions">
      <button id="primaryAction" type="button">Scan</button>
      <details id="actionMenu" class="action-menu">
        <summary role="button">More</summary>
        <div class="menu-list">
          <button id="refresh" class="secondary" type="button">Refresh</button>
          <button id="init" type="button">Make Repo</button>
          <button id="ignore" type="button">Fix Ignore</button>
          <button id="github" type="button">Create GitHub</button>
          <button id="push" class="danger" type="button">Commit + Push</button>
        </div>
      </details>
    </section>

    <section class="panel status">
      <h2>Status</h2>
      <div class="row"><span>Git</span><strong id="gitStatus">...</strong></div>
      <div class="row"><span>Remote</span><strong id="remoteStatus">...</strong></div>
      <div class="row"><span>GitHub</span><strong id="githubStatus">...</strong></div>
      <div class="row"><span>Scan</span><strong id="scanStatus">Not scanned</strong></div>
    </section>

    <section class="panel">
      <h2>Privacy Review</h2>
      <div id="privacy" class="stack"></div>
    </section>

    <details class="disclosure">
      <summary>Commit / Repo Details</summary>
      <section class="disclosure-body form">
        <label>Commit message<input id="message" value="Manual project backup"></label>
        <label>GitHub repo name<input id="repoName"></label>
        <label>Visibility<select id="visibility"><option value="private">Private</option><option value="public">Public</option></select></label>
      </section>
    </details>

    <section class="panel">
      <h2>Findings</h2>
      <div id="findings" class="stack"></div>
    </section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const els = {
      workspace: document.querySelector("#workspace"),
      gitStatus: document.querySelector("#gitStatus"),
      remoteStatus: document.querySelector("#remoteStatus"),
      githubStatus: document.querySelector("#githubStatus"),
      scanStatus: document.querySelector("#scanStatus"),
      privacy: document.querySelector("#privacy"),
      findings: document.querySelector("#findings"),
      message: document.querySelector("#message"),
      repoName: document.querySelector("#repoName"),
      visibility: document.querySelector("#visibility"),
      primaryAction: document.querySelector("#primaryAction"),
      push: document.querySelector("#push")
    };
    let latestProject = null;

    function post(type, payload = {}) {
      vscode.postMessage({ type, ...payload });
    }

    function privacyChoices() {
      const inputs = [...els.privacy.querySelectorAll("input[type='checkbox']")];
      return {
        ignoreRules: inputs.filter((input) => input.dataset.kind === "ignore" && input.checked).map((input) => input.dataset.value),
        csvPrivatePaths: inputs.filter((input) => input.dataset.kind === "csv" && input.checked).map((input) => input.dataset.value)
      };
    }

    function canPush(project) {
      return Boolean(project && project.isGitRepo && project.remote);
    }

    function renderPrimaryAction(project) {
      const readyToPush = canPush(project);
      els.primaryAction.textContent = readyToPush ? "Scan + Commit + Push" : "Scan";
      els.primaryAction.title = readyToPush
        ? "Run the privacy scan, then commit and push if it is clean."
        : "Run the privacy scan.";
      els.push.disabled = !readyToPush;
      els.push.title = readyToPush ? "" : "Add an origin remote before pushing.";
    }

    function option(title, detail, checked, disabled, kind, value) {
      const label = document.createElement("label");
      label.className = "privacy-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      input.disabled = disabled;
      input.dataset.kind = kind;
      input.dataset.value = value;
      const span = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = title;
      const small = document.createElement("small");
      small.textContent = detail;
      span.append(strong, small);
      label.append(input, span);
      return label;
    }

    function renderPrivacy(review) {
      els.privacy.replaceChildren();
      const missing = review.ignoreRules.filter((item) => !item.present);
      const present = review.ignoreRules.filter((item) => item.present);
      const groups = [
        ["Add to .gitignore", missing, (item) => option(item.rule, "Suggested ignore rule", item.selected, false, "ignore", item.rule)],
        ["Make public CSV copies", review.csvCopies, (item) => option(item.publicPath, "From " + item.privatePath, item.selected, false, "csv", item.privatePath)],
        ["Already ignored", present, (item) => option(item.rule, "Already in .gitignore", true, true, "ignore", item.rule)]
      ];

      for (const [title, items, renderer] of groups) {
        if (!items.length) continue;
        const group = title === "Already ignored" ? document.createElement("details") : document.createElement("div");
        group.className = title === "Already ignored" ? "privacy-disclosure" : "privacy-group";
        const heading = document.createElement(title === "Already ignored" ? "summary" : "h3");
        heading.textContent = title === "Already ignored" ? title + " (" + items.length + ")" : title;
        group.append(heading, ...items.map(renderer));
        els.privacy.append(group);
      }

      if (!els.privacy.children.length) {
        const p = document.createElement("p");
        p.textContent = "No privacy suggestions for this workspace.";
        els.privacy.append(p);
      }
    }

    function renderFindings(scan) {
      els.findings.replaceChildren();
      if (!scan) {
        els.findings.append(Object.assign(document.createElement("p"), { textContent: "Run a scan to see findings." }));
        return;
      }
      els.scanStatus.textContent = scan.safe ? "Clean" : "Blocked";
      if (!scan.findings.length) {
        els.findings.append(Object.assign(document.createElement("p"), { textContent: "No sensitive info found." }));
        return;
      }
      for (const finding of scan.findings) {
        const item = document.createElement("div");
        item.className = "finding";
        const title = document.createElement("strong");
        title.textContent = finding.path + (finding.line ? ":" + finding.line : "") + " - " + finding.reason;
        const preview = document.createElement("small");
        preview.textContent = finding.preview || "Review this file before pushing.";
        const row = document.createElement("div");
        row.className = "actions";
        const open = document.createElement("button");
        open.className = "secondary";
        open.textContent = "Open";
        open.addEventListener("click", () => post("openFinding", { finding }));
        const approve = document.createElement("button");
        approve.textContent = "Mark OK";
        approve.addEventListener("click", () => post("approveFinding", { finding }));
        row.append(open, approve);
        item.append(title, preview, row);
        els.findings.append(item);
      }
    }

    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "state") {
        latestProject = message.project;
        els.workspace.textContent = message.project.path;
        els.repoName.value ||= message.project.name;
        els.gitStatus.textContent = message.project.isGitRepo ? "Repository found" : "Not a Git repo";
        els.remoteStatus.textContent = message.project.remote || "No origin";
        els.githubStatus.textContent = message.github.loggedIn ? (message.github.account || "Connected") : "Not connected";
        renderPrimaryAction(message.project);
        renderPrivacy(message.privacy);
        renderFindings(message.scan);
      }
    });

    document.querySelector("#refresh").addEventListener("click", () => post("refresh"));
    document.querySelector("#primaryAction").addEventListener("click", () => {
      if (canPush(latestProject)) {
        post("push", { privacy: privacyChoices(), message: els.message.value });
        return;
      }
      post("scan");
    });
    document.querySelector("#init").addEventListener("click", () => post("init", { privacy: privacyChoices() }));
    document.querySelector("#ignore").addEventListener("click", () => post("ignore", { privacy: privacyChoices() }));
    document.querySelector("#github").addEventListener("click", () => post("github", { privacy: privacyChoices(), repoName: els.repoName.value, visibility: els.visibility.value, message: els.message.value }));
    document.querySelector("#push").addEventListener("click", () => post("push", { privacy: privacyChoices(), message: els.message.value }));
    document.querySelector("#actionMenu").addEventListener("click", (event) => {
      if (event.target.tagName === "BUTTON") {
        event.currentTarget.removeAttribute("open");
      }
    });
    post("refresh");
  </script>
</body>
</html>`;
}

class AutoGithubPushViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.scan = null;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = webviewHtml(webviewView.webview, this.extensionUri);
    webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
  }

  async postState() {
    if (!this.view) return;
    const projectPath = activeWorkspacePath();
    const [project, github, privacy] = await Promise.all([
      getProjectStatus(projectPath),
      getGithubStatus(),
      getPrivacyReview(projectPath)
    ]);
    this.view.webview.postMessage({
      type: "state",
      project: { ...project, name: workspaceName(projectPath) },
      github,
      privacy,
      scan: this.scan
    });
  }

  async handleMessage(message) {
    try {
      const projectPath = activeWorkspacePath();
      if (message.type === "refresh") {
        await this.postState();
      } else if (message.type === "scan") {
        this.scan = await scanSensitiveInfo(projectPath);
        await this.postState();
      } else if (message.type === "ignore") {
        await ensureGitignore(projectPath, message.privacy?.ignoreRules || []);
        vscode.window.showInformationMessage(".gitignore updated.");
        await this.postState();
      } else if (message.type === "init") {
        const result = await initializeRepository(projectPath, message.privacy || {});
        this.scan = result.scan;
        await notifyResult(result, result.initialized ? "Repository created." : result.output);
        await this.postState();
      } else if (message.type === "github") {
        const result = await createGithubRepository(projectPath, {
          ...message.privacy,
          repoName: message.repoName || workspaceName(projectPath),
          visibility: message.visibility,
          message: message.message,
          confirmed: true
        });
        this.scan = result.scan;
        await notifyResult(result, result.created ? `Created ${result.repoName}.` : result.output);
        await this.postState();
      } else if (message.type === "push") {
        const result = await commitAndPush(projectPath, message.message, true, message.privacy || {});
        this.scan = result.scan;
        await notifyResult(result, result.changed ? "Commit and push finished." : result.output);
        await this.postState();
      } else if (message.type === "openFinding") {
        const target = vscode.Uri.file(path.join(projectPath, message.finding.path));
        const document = await vscode.workspace.openTextDocument(target);
        const line = Math.max(0, Number(message.finding.line || 1) - 1);
        await vscode.window.showTextDocument(document, {
          selection: new vscode.Range(line, 0, line, 0)
        });
      } else if (message.type === "approveFinding") {
        this.scan = await approveSensitiveFinding(projectPath, message.finding.id);
        await this.postState();
      }
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  }
}

function activate(context) {
  const provider = new AutoGithubPushViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("autoGithubPush.view", provider),
    vscode.commands.registerCommand("autoGithubPush.open", () => vscode.commands.executeCommand("workbench.view.extension.autoGithubPush")),
    vscode.commands.registerCommand("autoGithubPush.scan", () => commandWithWorkspace(async (projectPath) => {
      const result = await scanSensitiveInfo(projectPath);
      vscode.window.showInformationMessage(result.safe ? `Clean scan: ${result.scannedFiles} files.` : `Scan blocked: ${result.findings.length} finding(s).`);
      provider.scan = result;
      await provider.postState();
    })),
    vscode.commands.registerCommand("autoGithubPush.fixGitignore", () => commandWithWorkspace(async (projectPath) => {
      const privacy = await choosePrivacy(projectPath);
      if (!privacy) return;
      const result = await ensureGitignore(projectPath, privacy.ignoreRules);
      vscode.window.showInformationMessage(result.changed ? ".gitignore updated." : "No new .gitignore rules selected.");
      await provider.postState();
    })),
    vscode.commands.registerCommand("autoGithubPush.commitAndPush", () => commandWithWorkspace(async (projectPath) => {
      const privacy = await choosePrivacy(projectPath);
      if (!privacy) return;
      const message = await vscode.window.showInputBox({
        prompt: "Commit message",
        value: "Manual project backup",
        ignoreFocusOut: true
      });
      if (message === undefined) return;
      const result = await commitAndPush(projectPath, message, true, privacy);
      await notifyResult(result, result.changed ? "Commit and push finished." : result.output);
      provider.scan = result.scan;
      await provider.postState();
    }))
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
