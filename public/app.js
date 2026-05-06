const state = {
  projects: [],
  scans: new Map(),
  selectedName: ""
};

const elements = {
  rootPath: document.querySelector("#rootPath"),
  safeCount: document.querySelector("#safeCount"),
  attentionCount: document.querySelector("#attentionCount"),
  blockedCount: document.querySelector("#blockedCount"),
  projectCount: document.querySelector("#projectCount"),
  projects: document.querySelector("#projects"),
  refreshButton: document.querySelector("#refreshButton"),
  githubStatus: document.querySelector("#githubStatus"),
  startupToggle: document.querySelector("#startupToggle"),
  emptyState: document.querySelector("#emptyState"),
  projectDetail: document.querySelector("#projectDetail"),
  selectedName: document.querySelector("#selectedName"),
  selectedPath: document.querySelector("#selectedPath"),
  selectedBadge: document.querySelector("#selectedBadge"),
  gitStatus: document.querySelector("#gitStatus"),
  ignoreStatus: document.querySelector("#ignoreStatus"),
  remoteStatus: document.querySelector("#remoteStatus"),
  warnings: document.querySelector("#warnings"),
  changes: document.querySelector("#changes"),
  openButton: document.querySelector("#openButton"),
  scanButton: document.querySelector("#scanButton"),
  initializeButton: document.querySelector("#initializeButton"),
  githubButton: document.querySelector("#githubButton"),
  gitignoreButton: document.querySelector("#gitignoreButton"),
  commitButton: document.querySelector("#commitButton"),
  scanStatus: document.querySelector("#scanStatus"),
  scanFindings: document.querySelector("#scanFindings"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmProject: document.querySelector("#confirmProject"),
  commitMessage: document.querySelector("#commitMessage"),
  confirmPushButton: document.querySelector("#confirmPushButton"),
  pushPrivacyReview: document.querySelector("#pushPrivacyReview"),
  initializeDialog: document.querySelector("#initializeDialog"),
  initializeProject: document.querySelector("#initializeProject"),
  initializePrivacyReview: document.querySelector("#initializePrivacyReview"),
  confirmInitializeButton: document.querySelector("#confirmInitializeButton"),
  gitignoreDialog: document.querySelector("#gitignoreDialog"),
  gitignoreProject: document.querySelector("#gitignoreProject"),
  gitignorePrivacyReview: document.querySelector("#gitignorePrivacyReview"),
  confirmGitignoreButton: document.querySelector("#confirmGitignoreButton"),
  githubDialog: document.querySelector("#githubDialog"),
  githubProject: document.querySelector("#githubProject"),
  githubRepoName: document.querySelector("#githubRepoName"),
  githubVisibility: document.querySelector("#githubVisibility"),
  githubCommitMessage: document.querySelector("#githubCommitMessage"),
  confirmGithubButton: document.querySelector("#confirmGithubButton"),
  githubPrivacyReview: document.querySelector("#githubPrivacyReview"),
  toast: document.querySelector("#toast")
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.classList.remove("visible");
  }, 3200);
}

function statusText(project) {
  if (project.state === "blocked") return "Blocked";
  if (project.state === "attention") return "Needs attention";
  return "Safe";
}

function renderList() {
  elements.projectCount.textContent = String(state.projects.length);
  elements.safeCount.textContent = String(state.projects.filter((project) => project.state === "safe").length);
  elements.attentionCount.textContent = String(state.projects.filter((project) => project.state === "attention").length);
  elements.blockedCount.textContent = String(state.projects.filter((project) => project.state === "blocked").length);
  elements.projects.replaceChildren();

  for (const project of state.projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `project-button ${project.state}`;
    if (project.name === state.selectedName) {
      button.classList.add("selected");
    }

    const title = document.createElement("span");
    title.className = "project-title";
    title.innerHTML = `<span class="dot" aria-hidden="true"></span><strong></strong>`;
    title.querySelector("strong").textContent = project.name;

    const meta = document.createElement("span");
    meta.className = "project-meta";
    const detail = project.blockers?.[0] || project.warnings?.[0] || project.remote || "Ready for manual action";
    meta.textContent = detail;

    const badge = document.createElement("span");
    badge.className = `mini-badge ${project.state}`;
    badge.textContent = statusText(project);

    button.append(title, meta, badge);
    button.title = "Click to inspect. Double-click to open in VS Code.";
    button.addEventListener("click", () => selectProject(project.name));
    button.addEventListener("dblclick", async () => {
      selectProject(project.name);
      try {
        await window.autoGithubPush.openInVsCode(project.name);
        showToast(`Opened ${project.name} in VS Code.`);
      } catch (error) {
        showToast(error.message);
      }
    });
    elements.projects.append(button);
  }
}

function renderItems(list, items, fallback) {
  list.replaceChildren();
  const values = items.length > 0 ? items : [fallback];
  for (const item of values) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
}

function formatScanFinding(finding) {
  const line = finding.line ? `:${finding.line}` : "";
  return `${finding.path}${line} - ${finding.reason}`;
}

function renderScanFindings(project, scan) {
  elements.scanFindings.replaceChildren();

  if (!scan) {
    const li = document.createElement("li");
    li.textContent = "Run Scan + Make Repo before initializing a folder.";
    elements.scanFindings.append(li);
    return;
  }

  if (scan.findings.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No sensitive info found.";
    elements.scanFindings.append(li);
    return;
  }

  for (const finding of scan.findings) {
    const li = document.createElement("li");
    li.className = "finding-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "finding-button";
    button.title = "Open this finding in VS Code";

    const title = document.createElement("strong");
    title.textContent = formatScanFinding(finding);

    const preview = document.createElement("span");
    preview.textContent = finding.preview || "Review this file before pushing.";

    button.append(title, preview);
    button.addEventListener("click", async () => {
      try {
        await window.autoGithubPush.openFindingInVsCode({
          projectName: project.name,
          path: finding.path,
          line: finding.line || 1
        });
        showToast(`Opened ${finding.path} in VS Code.`);
      } catch (error) {
        showToast(error.message);
      }
    });

    const approveButton = document.createElement("button");
    approveButton.type = "button";
    approveButton.className = "approve-finding-button";
    approveButton.textContent = "Mark OK";
    approveButton.title = "Approve this exact finding and rescan";
    approveButton.addEventListener("click", async () => {
      approveButton.disabled = true;
      try {
        const updatedScan = await window.autoGithubPush.approveSensitiveFinding({
          projectName: project.name,
          findingId: finding.id
        });
        state.scans.set(project.name, updatedScan);
        showToast("Finding approved. Scan refreshed.");
        selectProject(project.name);
      } catch (error) {
        approveButton.disabled = false;
        showToast(error.message);
      }
    });

    li.append(button, approveButton);
    elements.scanFindings.append(li);
  }
}

function emptyPrivacyMessage(text) {
  const p = document.createElement("p");
  p.className = "privacy-empty";
  p.textContent = text;
  return p;
}

function privacyOption(titleText, detailText, checked, disabled, kind, value) {
  const label = document.createElement("label");
  label.className = "privacy-option";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.disabled = disabled;
  input.dataset.kind = kind;
  input.dataset.value = value;

  const text = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("small");
  detail.textContent = detailText;
  text.append(title, detail);

  label.append(input, text);
  return label;
}

async function renderPrivacyReview(projectName, target) {
  target.replaceChildren(emptyPrivacyMessage("Loading privacy choices..."));
  const review = await window.autoGithubPush.getPrivacyReview(projectName);
  target.replaceChildren();

  const missingRules = review.ignoreRules.filter((item) => !item.present);
  const presentRules = review.ignoreRules.filter((item) => item.present);

  if (missingRules.length === 0 && presentRules.length === 0 && review.csvCopies.length === 0) {
    target.append(emptyPrivacyMessage("No privacy suggestions for this project."));
    return;
  }

  if (missingRules.length > 0) {
    const group = document.createElement("div");
    group.className = "privacy-group";
    const h4 = document.createElement("h4");
    h4.textContent = "Add to .gitignore";
    group.append(h4);
    for (const item of missingRules) {
      group.append(privacyOption(item.rule, "Suggested ignore rule", item.selected, false, "ignore", item.rule));
    }
    target.append(group);
  }

  if (review.csvCopies.length > 0) {
    const group = document.createElement("div");
    group.className = "privacy-group";
    const h4 = document.createElement("h4");
    h4.textContent = "Make public CSV copies";
    group.append(h4);
    for (const item of review.csvCopies) {
      group.append(privacyOption(item.publicPath, `From ${item.privatePath}`, item.selected, false, "csv", item.privatePath));
    }
    target.append(group);
  }

  if (presentRules.length > 0) {
    const group = document.createElement("div");
    group.className = "privacy-group";
    const h4 = document.createElement("h4");
    h4.textContent = "Already ignored";
    group.append(h4);
    for (const item of presentRules) {
      group.append(privacyOption(item.rule, "Already in .gitignore", true, true, "ignore", item.rule));
    }
    target.append(group);
  }
}

function collectPrivacyChoices(target) {
  const inputs = [...target.querySelectorAll("input[type='checkbox']")];
  return {
    ignoreRules: inputs
      .filter((input) => input.dataset.kind === "ignore" && input.checked)
      .map((input) => input.dataset.value),
    csvPrivatePaths: inputs
      .filter((input) => input.dataset.kind === "csv" && input.checked)
      .map((input) => input.dataset.value)
  };
}

function repoNameFromProject(name) {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
}

function selectedProject() {
  return state.projects.find((project) => project.name === state.selectedName);
}

function selectProject(name) {
  state.selectedName = name;
  const project = selectedProject();
  renderList();

  if (!project) {
    elements.emptyState.classList.remove("hidden");
    elements.projectDetail.classList.add("hidden");
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.projectDetail.classList.remove("hidden");
  elements.selectedName.textContent = project.name;
  elements.selectedPath.textContent = project.path;
  elements.selectedBadge.className = `status-badge ${project.state}`;
  elements.selectedBadge.textContent = statusText(project);
  elements.gitStatus.textContent = project.isGitRepo ? "Repository found" : "Not a Git repository";
  elements.ignoreStatus.textContent = project.hasGitignore ? ".gitignore present" : "Missing .gitignore";
  elements.remoteStatus.textContent = project.remote || "No origin remote";
  const scan = state.scans.get(project.name);
  elements.scanStatus.textContent = scan
    ? `${scan.safe ? "Clean" : "Blocked"} (${scan.scannedFiles} files scanned${scan.approvedFindings ? `, ${scan.approvedFindings} approved` : ""})`
    : "Not scanned yet";
  elements.initializeButton.disabled = project.isGitRepo;
  elements.githubButton.disabled = Boolean(project.remote);
  elements.commitButton.disabled = !project.isGitRepo;

  const attention = [...(project.blockers || []), ...(project.warnings || [])];
  renderItems(elements.warnings, attention, "No blockers or warnings.");
  renderScanFindings(project, scan);
  renderItems(elements.changes, project.changes || [], "No current changes reported.");
}

async function loadProjects() {
  elements.refreshButton.disabled = true;
  try {
    const [payload, github] = await Promise.all([
      window.autoGithubPush.listProjects(),
      window.autoGithubPush.getGithubStatus()
    ]);
    state.projects = payload.projects;
    elements.rootPath.textContent = payload.root;
    elements.githubStatus.textContent = github.loggedIn
      ? github.account || "Connected"
      : "Not connected";
    elements.startupToggle.checked = payload.startupEnabled;
    renderList();
    if (state.selectedName) {
      selectProject(state.selectedName);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function withSelectedProject(callback) {
  const project = selectedProject();
  if (!project) {
    showToast("Select a project first.");
    return;
  }

  await callback(project);
}

elements.refreshButton.addEventListener("click", loadProjects);

elements.openButton.addEventListener("click", () => withSelectedProject(async (project) => {
  await window.autoGithubPush.openInVsCode(project.name);
  showToast(`Opened ${project.name} in VS Code.`);
}));

elements.scanButton.addEventListener("click", () => withSelectedProject(async (project) => {
  elements.scanButton.disabled = true;
  elements.scanButton.textContent = "Scanning...";
  try {
    const scan = await window.autoGithubPush.scanSensitiveInfo(project.name);
    state.scans.set(project.name, scan);
    showToast(scan.safe ? "Scan is clean." : "Scan found sensitive-looking info.");
    selectProject(project.name);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.scanButton.disabled = false;
    elements.scanButton.textContent = "Rescan";
  }
}));

elements.gitignoreButton.addEventListener("click", () => withSelectedProject(async (project) => {
  elements.gitignoreProject.textContent = `${project.name} can add the checked rules to .gitignore.`;
  elements.confirmGitignoreButton.disabled = true;
  elements.gitignoreDialog.showModal();
  try {
    await renderPrivacyReview(project.name, elements.gitignorePrivacyReview);
  } catch (error) {
    elements.gitignorePrivacyReview.replaceChildren(emptyPrivacyMessage(error.message));
  } finally {
    elements.confirmGitignoreButton.disabled = false;
  }
}));

elements.gitignoreDialog.addEventListener("close", async () => {
  if (elements.gitignoreDialog.returnValue !== "confirm") {
    return;
  }

  await withSelectedProject(async (project) => {
    elements.confirmGitignoreButton.disabled = true;
    try {
      const choices = collectPrivacyChoices(elements.gitignorePrivacyReview);
      const result = await window.autoGithubPush.ensureGitignore({
        projectName: project.name,
        ignoreRules: choices.ignoreRules
      });
      showToast(result.changed ? "Updated .gitignore." : "No new .gitignore rules selected.");
      await loadProjects();
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.confirmGitignoreButton.disabled = false;
      selectProject(project.name);
    }
  });
});

elements.initializeButton.addEventListener("click", () => withSelectedProject(async (project) => {
  elements.initializeProject.textContent = `${project.name} will be scanned before a local Git repo is created.`;
  elements.confirmInitializeButton.disabled = true;
  elements.initializeDialog.showModal();
  try {
    await renderPrivacyReview(project.name, elements.initializePrivacyReview);
  } catch (error) {
    elements.initializePrivacyReview.replaceChildren(emptyPrivacyMessage(error.message));
  } finally {
    elements.confirmInitializeButton.disabled = false;
  }
}));

elements.initializeDialog.addEventListener("close", async () => {
  if (elements.initializeDialog.returnValue !== "confirm") {
    return;
  }

  await withSelectedProject(async (project) => {
  elements.initializeButton.disabled = true;
  elements.confirmInitializeButton.disabled = true;
  elements.confirmInitializeButton.textContent = "Scanning...";
  try {
    const result = await window.autoGithubPush.initializeRepository({
      projectName: project.name,
      privacy: collectPrivacyChoices(elements.initializePrivacyReview)
    });
    state.scans.set(project.name, result.scan);

    if (result.blocked) {
      showToast("Repo creation blocked. Sensitive-looking info was found.");
      selectProject(project.name);
      return;
    }

    showToast(result.initialized ? "Repository created after a clean scan." : result.output);
    await loadProjects();
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.confirmInitializeButton.disabled = false;
    elements.confirmInitializeButton.textContent = "Scan and Create";
    elements.initializeButton.textContent = "Scan + Make Repo";
    selectProject(project.name);
  }
  });
});

elements.githubButton.addEventListener("click", () => withSelectedProject(async (project) => {
  elements.githubProject.textContent = `${project.name} will be scanned before any GitHub repo is created.`;
  elements.githubRepoName.value = repoNameFromProject(project.name);
  elements.githubVisibility.value = "private";
  elements.githubCommitMessage.value = "Initial project backup";
  elements.confirmGithubButton.disabled = true;
  elements.githubDialog.showModal();
  try {
    await renderPrivacyReview(project.name, elements.githubPrivacyReview);
  } catch (error) {
    elements.githubPrivacyReview.replaceChildren(emptyPrivacyMessage(error.message));
  } finally {
    elements.confirmGithubButton.disabled = false;
  }
}));

elements.githubDialog.addEventListener("close", async () => {
  if (elements.githubDialog.returnValue !== "confirm") {
    return;
  }

  await withSelectedProject(async (project) => {
    elements.confirmGithubButton.disabled = true;
    elements.confirmGithubButton.textContent = "Scanning...";
    try {
      const result = await window.autoGithubPush.createGithubRepository({
        projectName: project.name,
        repoName: elements.githubRepoName.value,
        visibility: elements.githubVisibility.value,
        message: elements.githubCommitMessage.value,
        confirmed: true,
        privacy: collectPrivacyChoices(elements.githubPrivacyReview)
      });

      if (result.scan) {
        state.scans.set(project.name, result.scan);
      }
      if (result.blocked) {
        showToast("GitHub repo creation blocked. Sensitive-looking info was found.");
        selectProject(project.name);
        return;
      }

      showToast(`Created ${result.visibility} GitHub repo: ${result.repoName}`);
      await loadProjects();
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.confirmGithubButton.disabled = false;
      elements.confirmGithubButton.textContent = "Scan and Create";
      selectProject(project.name);
    }
  });
});

elements.commitButton.addEventListener("click", () => withSelectedProject(async (project) => {
  elements.confirmProject.textContent = `${project.name} will be committed and pushed to origin.`;
  elements.confirmPushButton.disabled = true;
  elements.confirmDialog.showModal();
  try {
    await renderPrivacyReview(project.name, elements.pushPrivacyReview);
  } catch (error) {
    elements.pushPrivacyReview.replaceChildren(emptyPrivacyMessage(error.message));
  } finally {
    elements.confirmPushButton.disabled = false;
  }
}));

elements.confirmDialog.addEventListener("close", async () => {
  if (elements.confirmDialog.returnValue !== "confirm") {
    return;
  }

  await withSelectedProject(async (project) => {
    elements.confirmPushButton.disabled = true;
    try {
      const result = await window.autoGithubPush.commitAndPush({
        projectName: project.name,
        message: elements.commitMessage.value,
        confirmed: true,
        privacy: collectPrivacyChoices(elements.pushPrivacyReview)
      });
      if (result.scan) {
        state.scans.set(project.name, result.scan);
      }
      if (result.blocked) {
        showToast("Commit and push blocked. Sensitive-looking info was found.");
        selectProject(project.name);
        return;
      }
      showToast(result.output || "Commit and push finished.");
      await loadProjects();
    } catch (error) {
      showToast(error.message);
    } finally {
      elements.confirmPushButton.disabled = false;
    }
  });
});

elements.startupToggle.addEventListener("change", async () => {
  const enabled = elements.startupToggle.checked;
  elements.startupToggle.disabled = true;
  try {
    await window.autoGithubPush.setStartup(enabled);
    showToast(enabled ? "Startup launch enabled." : "Startup launch disabled.");
  } catch (error) {
    elements.startupToggle.checked = !enabled;
    showToast(error.message);
  } finally {
    elements.startupToggle.disabled = false;
  }
});

loadProjects();
