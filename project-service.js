const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const ROOT_DIR = __dirname;
const PROJECTS_DIR = process.env.PROJECTS_DIR
  ? path.resolve(process.env.PROJECTS_DIR)
  : path.resolve(ROOT_DIR, "..");

const STARTUP_SCRIPT = path.join(
  process.env.APPDATA || "",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup",
  "Auto Github Push.cmd"
);
const DATA_DIR = path.join(process.env.APPDATA || ROOT_DIR, "Auto Github Push");
const APPROVALS_FILE = path.join(DATA_DIR, "approved-findings.json");

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv"
]);

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /^id_rsa$/i,
  /^id_dsa$/i,
  /^id_ecdsa$/i,
  /^id_ed25519$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^credentials(?:\..*)?$/i,
  /^secrets?(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i
];

const SECRET_CONTENT_PATTERNS = [
  { label: "Private key block", pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { label: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  {
    label: "Credential assignment",
    pattern: /\b(?:api[_-]?key|secret|token|password|passwd|pwd|database_url|connection_string)\b\s*[:=]\s*["']?(?!changeme|example|placeholder|todo|your_|xxx|null|none|false|true)([^"'\s]{12,})/i
  }
];

const MAX_SCAN_FILE_SIZE = 1024 * 1024;
const MAX_SCAN_FILES = 6000;
const PRIVATE_CSV_SUFFIXES = [
  ".private.csv",
  ".personal.csv",
  ".sensitive.csv"
];
const DEFAULT_GITIGNORE_RULES = [
  "node_modules/",
  ".env",
  ".env.*",
  "*.private.csv",
  "*.personal.csv",
  "*.sensitive.csv",
  "*.log",
  "dist/",
  "build/",
  ".DS_Store",
  "Thumbs.db"
];

function commandPath(command) {
  if (command !== "gh" || process.platform !== "win32") {
    return command;
  }

  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "GitHub CLI", "gh.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "GitHub CLI", "gh.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "GitHub CLI", "gh.exe")
  ];

  return candidates.find((candidate) => {
    try {
      require("node:fs").accessSync(candidate);
      return true;
    } catch {
      return false;
    }
  }) || command;
}

function run(command, args, cwd) {
  return new Promise((resolve) => {
    execFile(commandPath(command), args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

function sanitizeRepoName(name) {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100);
}

function resolveProjectPath(projectName) {
  if (!projectName || typeof projectName !== "string") {
    throw new Error("Project name is required.");
  }

  if (path.isAbsolute(projectName)) {
    return path.resolve(projectName);
  }

  const resolved = path.resolve(PROJECTS_DIR, projectName);
  const relative = path.relative(PROJECTS_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Project path is outside the allowed folder.");
  }

  return resolved;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isLikelySensitiveFile(fileName) {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

function isLikelyText(buffer) {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return !sample.includes(0);
}

function redactPreview(line) {
  return line
    .replace(/\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{8,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g, "[REDACTED_SLACK_TOKEN]")
    .replace(
      /(\b(?:api[_-]?key|secret|token|password|passwd|pwd|database_url|connection_string)\b\s*[:=]\s*["']?)([^"'\s]{4,})/gi,
      "$1[REDACTED]"
    )
    .trim()
    .slice(0, 220);
}

function findSecretInText(text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const secretPattern of SECRET_CONTENT_PATTERNS) {
      if (secretPattern.pattern.test(line)) {
        return {
          line: index + 1,
          reason: secretPattern.label,
          preview: redactPreview(line)
        };
      }
    }
  }

  for (const secretPattern of SECRET_CONTENT_PATTERNS) {
    if (secretPattern.pattern.test(text)) {
      return {
        line: 1,
        reason: secretPattern.label,
        preview: "[Potential secret spans multiple lines]"
      };
    }
  }

  return null;
}

function stableHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function findingId(projectPath, relativePath, line, reason, evidence) {
  return stableHash([
    path.resolve(projectPath),
    relativePath,
    line || "",
    reason,
    stableHash(evidence || "")
  ].join("\n"));
}

async function readApprovals() {
  try {
    return JSON.parse(await fs.readFile(APPROVALS_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeApprovals(approvals) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(APPROVALS_FILE, `${JSON.stringify(approvals, null, 2)}\n`, "utf8");
}

function resolveProjectFilePath(projectName, relativeFilePath) {
  if (!relativeFilePath || typeof relativeFilePath !== "string") {
    throw new Error("File path is required.");
  }

  const projectPath = resolveProjectPath(projectName);
  const resolved = path.resolve(projectPath, relativeFilePath);
  const relative = path.relative(projectPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path is outside the selected project.");
  }

  return { projectPath, filePath: resolved };
}

async function scanSensitiveInfo(projectName) {
  const projectPath = resolveProjectPath(projectName);
  const approvals = await readApprovals();
  const approvedIds = new Set(approvals[projectPath] || []);
  const rawFindings = [];
  let scannedFiles = 0;
  let skippedFiles = 0;

  async function walk(currentPath, relativeDir = "") {
    if (scannedFiles >= MAX_SCAN_FILES) return;

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (scannedFiles >= MAX_SCAN_FILES) break;

      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          skippedFiles += 1;
          continue;
        }
        await walk(fullPath, relativePath);
        continue;
      }

      if (!entry.isFile()) continue;

      if (isLikelySensitiveFile(entry.name)) {
        rawFindings.push({
          id: findingId(projectPath, relativePath, null, "Sensitive filename", relativePath),
          path: relativePath,
          line: null,
          preview: "Sensitive file name. Review this file before pushing.",
          reason: "Sensitive filename",
          severity: "high"
        });
      }

      const stat = await fs.stat(fullPath);
      if (stat.size > MAX_SCAN_FILE_SIZE) {
        skippedFiles += 1;
        continue;
      }

      const buffer = await fs.readFile(fullPath);
      if (!isLikelyText(buffer)) {
        skippedFiles += 1;
        continue;
      }

      scannedFiles += 1;
      const text = buffer.toString("utf8");
      const secret = findSecretInText(text);
      if (secret) {
        rawFindings.push({
          id: findingId(projectPath, relativePath, secret.line, secret.reason, linesEvidence(text, secret.line)),
          path: relativePath,
          line: secret.line,
          preview: secret.preview,
          reason: secret.reason,
          severity: "high"
        });
      }
    }
  }

  await walk(projectPath);

  const findings = rawFindings.filter((finding) => !approvedIds.has(finding.id));

  return {
    safe: findings.length === 0,
    findings: findings.slice(0, 50),
    approvedFindings: rawFindings.length - findings.length,
    scannedFiles,
    skippedFiles,
    truncated: findings.length > 50 || scannedFiles >= MAX_SCAN_FILES
  };
}

function linesEvidence(text, line) {
  const lines = text.split(/\r?\n/);
  return lines[Math.max(0, Number(line) - 1)] || "";
}

function isPrivateCsvFile(fileName) {
  const normalized = fileName.toLowerCase();
  return PRIVATE_CSV_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function publicCsvFileName(fileName) {
  const suffix = PRIVATE_CSV_SUFFIXES.find((candidate) => fileName.toLowerCase().endsWith(candidate));
  if (!suffix) return null;
  return `${fileName.slice(0, -suffix.length)}.csv`;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (quoted) {
      if (char === "\"" && nextChar === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function stringifyCsvRow(row) {
  return row.map((field) => {
    const value = String(field || "");
    if (!/[",\r\n]/.test(value)) return value;
    return `"${value.replace(/"/g, "\"\"")}"`;
  }).join(",");
}

function createPlainCsvCopy(text) {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return "";
  return `${stringifyCsvRow(rows[0])}\n`;
}

async function preparePublicCsvCopies(projectName, csvPrivatePaths = null) {
  const projectPath = resolveProjectPath(projectName);
  const selectedPaths = Array.isArray(csvPrivatePaths)
    ? new Set(csvPrivatePaths)
    : null;
  const created = [];

  async function walk(currentPath, relativeDir = "") {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath, relativePath);
        }
        continue;
      }

      if (!entry.isFile() || !isPrivateCsvFile(entry.name)) continue;
      if (selectedPaths && !selectedPaths.has(relativePath)) continue;

      const publicName = publicCsvFileName(entry.name);
      if (!publicName) continue;

      const sourceText = await fs.readFile(fullPath, "utf8");
      const publicPath = path.join(currentPath, publicName);
      await fs.writeFile(publicPath, createPlainCsvCopy(sourceText), "utf8");
      created.push({
        privatePath: relativePath,
        publicPath: relativeDir ? path.join(relativeDir, publicName) : publicName
      });
    }
  }

  await walk(projectPath);
  return { created };
}

async function getPrivacyReview(projectName) {
  const projectPath = resolveProjectPath(projectName);
  const gitignorePath = path.join(projectPath, ".gitignore");
  const existing = await pathExists(gitignorePath)
    ? await fs.readFile(gitignorePath, "utf8")
    : "";
  const existingRules = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const csvCopies = [];

  async function walk(currentPath, relativeDir = "") {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath, relativePath);
        }
        continue;
      }

      if (!entry.isFile() || !isPrivateCsvFile(entry.name)) continue;

      const publicName = publicCsvFileName(entry.name);
      if (!publicName) continue;

      csvCopies.push({
        privatePath: relativePath,
        publicPath: relativeDir ? path.join(relativeDir, publicName) : publicName,
        selected: true
      });
    }
  }

  await walk(projectPath);

  return {
    ignoreRules: DEFAULT_GITIGNORE_RULES.map((rule) => ({
      rule,
      present: existingRules.has(rule),
      selected: !existingRules.has(rule)
    })),
    csvCopies
  };
}

function privacyOptionsWithDefaults(options = {}) {
  return {
    ignoreRules: Array.isArray(options.ignoreRules) ? options.ignoreRules : DEFAULT_GITIGNORE_RULES,
    csvPrivatePaths: Array.isArray(options.csvPrivatePaths) ? options.csvPrivatePaths : null
  };
}

async function approveSensitiveFinding(projectName, findingIdToApprove) {
  if (!findingIdToApprove || typeof findingIdToApprove !== "string") {
    throw new Error("Finding id is required.");
  }

  const projectPath = resolveProjectPath(projectName);
  const approvals = await readApprovals();
  const projectApprovals = new Set(approvals[projectPath] || []);
  projectApprovals.add(findingIdToApprove);
  approvals[projectPath] = [...projectApprovals].sort();
  await writeApprovals(approvals);
  return scanSensitiveInfo(projectName);
}

async function getProjectStatus(projectName) {
  const projectPath = resolveProjectPath(projectName);
  const stat = await fs.stat(projectPath);
  if (!stat.isDirectory()) {
    throw new Error("Selected item is not a folder.");
  }

  const isGitRepo = await pathExists(path.join(projectPath, ".git"));
  const hasGitignore = await pathExists(path.join(projectPath, ".gitignore"));
  const packageJson = await pathExists(path.join(projectPath, "package.json"));
  const envFile = await pathExists(path.join(projectPath, ".env"));
  const gitStatus = isGitRepo ? await run("git", ["status", "--short"], projectPath) : null;
  const remote = isGitRepo ? await run("git", ["remote", "get-url", "origin"], projectPath) : null;

  const blockers = [];
  const warnings = [];

  if (!isGitRepo) blockers.push("Not a Git repository");
  if (!hasGitignore) warnings.push("Missing .gitignore");
  if (envFile && !hasGitignore) warnings.push(".env exists and no .gitignore is present");
  if (isGitRepo && remote && !remote.ok) warnings.push("No origin remote configured");

  let state = "safe";
  if (blockers.length > 0) {
    state = "blocked";
  } else if (warnings.length > 0 || (gitStatus && gitStatus.stdout)) {
    state = "attention";
  }

  return {
    name: path.basename(projectPath),
    path: projectPath,
    state,
    isGitRepo,
    hasGitignore,
    packageJson,
    envFile,
    remote: remote && remote.ok ? remote.stdout : "",
    changes: gitStatus && gitStatus.ok && gitStatus.stdout
      ? gitStatus.stdout.split(/\r?\n/).slice(0, 8)
      : [],
    blockers,
    warnings
  };
}

async function listProjects() {
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const statuses = [];
  for (const folder of folders) {
    try {
      statuses.push(await getProjectStatus(folder));
    } catch (error) {
      statuses.push({
        name: folder,
        path: path.join(PROJECTS_DIR, folder),
        state: "blocked",
        blockers: [error.message],
        warnings: [],
        changes: []
      });
    }
  }

  return {
    root: PROJECTS_DIR,
    startupEnabled: STARTUP_SCRIPT ? await pathExists(STARTUP_SCRIPT) : false,
    projects: statuses
  };
}

async function getGithubStatus() {
  const status = await run("gh", ["auth", "status"], ROOT_DIR);
  if (!status.ok) {
    return {
      available: false,
      loggedIn: false,
      account: "",
      message: status.stderr || status.stdout || "GitHub CLI is not authenticated."
    };
  }

  const output = `${status.stdout}\n${status.stderr}`;
  const accountMatch = output.match(/Logged in to github\.com account\s+([^\s]+)/i);
  return {
    available: true,
    loggedIn: true,
    account: accountMatch ? accountMatch[1] : "",
    message: "GitHub CLI is authenticated."
  };
}

async function openInVsCode(projectName) {
  const projectPath = resolveProjectPath(projectName);
  const result = await run("code", [projectPath], ROOT_DIR);
  if (!result.ok) {
    throw new Error("Could not open VS Code. Make sure the 'code' command is installed.");
  }
  return { ok: true };
}

async function openFindingInVsCode(projectName, relativeFilePath, line) {
  const { projectPath, filePath } = resolveProjectFilePath(projectName, relativeFilePath);
  const target = `${filePath}:${Number(line) > 0 ? Number(line) : 1}`;
  const result = await run("code", ["-r", projectPath, "-g", target], ROOT_DIR);
  if (!result.ok) {
    throw new Error("Could not open the finding in VS Code. Make sure the 'code' command is installed.");
  }
  return { ok: true };
}

async function ensureGitignore(projectName, selectedRules = DEFAULT_GITIGNORE_RULES) {
  const projectPath = resolveProjectPath(projectName);
  const gitignorePath = path.join(projectPath, ".gitignore");
  const existing = await pathExists(gitignorePath)
    ? await fs.readFile(gitignorePath, "utf8")
    : "";

  const rules = Array.isArray(selectedRules)
    ? selectedRules
    : DEFAULT_GITIGNORE_RULES;

  const missing = rules.filter((rule) => !existing.split(/\r?\n/).includes(rule));
  if (missing.length === 0) {
    return { changed: false, added: [] };
  }

  const prefix = existing.trim().length > 0 ? `${existing.replace(/\s*$/, "")}\n\n` : "";
  await fs.writeFile(gitignorePath, `${prefix}${missing.join("\n")}\n`, "utf8");
  return { changed: true, added: missing };
}

async function initializeRepository(projectName, options = {}) {
  const projectPath = resolveProjectPath(projectName);
  if (await pathExists(path.join(projectPath, ".git"))) {
    return { initialized: false, scan: await scanSensitiveInfo(projectName), output: "Already a Git repository." };
  }

  const privacy = privacyOptionsWithDefaults(options);
  const gitignore = await ensureGitignore(projectName, privacy.ignoreRules);
  const csvCopies = await preparePublicCsvCopies(projectName, privacy.csvPrivatePaths);
  const scan = await scanSensitiveInfo(projectName);
  if (!scan.safe) {
    return {
      initialized: false,
      blocked: true,
      scan,
      output: "Repository creation blocked by the sensitive-info scan."
    };
  }

  const init = await run("git", ["init"], projectPath);
  if (!init.ok) {
    throw new Error(init.stderr || init.stdout || "Git init failed.");
  }

  return {
    initialized: true,
    blocked: false,
    gitignore,
    csvCopies,
    scan,
    output: init.stdout || "Initialized empty Git repository."
  };
}

async function commitAndPush(projectName, message, confirmed, options = {}) {
  if (confirmed !== true) {
    throw new Error("Confirmation is required before committing or pushing.");
  }

  const projectPath = resolveProjectPath(projectName);
  if (!(await pathExists(path.join(projectPath, ".git")))) {
    throw new Error("Selected project is not a Git repository.");
  }

  const remote = await run("git", ["remote", "get-url", "origin"], projectPath);
  if (!remote.ok) {
    throw new Error("No origin remote is configured.");
  }

  const privacy = privacyOptionsWithDefaults(options);
  await ensureGitignore(projectName, privacy.ignoreRules);
  const csvCopies = await preparePublicCsvCopies(projectName, privacy.csvPrivatePaths);
  const scan = await scanSensitiveInfo(projectName);
  if (!scan.safe) {
    return {
      blocked: true,
      changed: false,
      scan,
      output: "Commit and push blocked by the sensitive-info scan."
    };
  }

  const status = await run("git", ["status", "--short"], projectPath);
  if (!status.stdout) {
    return { changed: false, scan, output: "Nothing to commit." };
  }

  await run("git", ["add", "--all"], projectPath);
  const commit = await run("git", ["commit", "-m", message || "Manual project backup"], projectPath);
  if (!commit.ok) {
    throw new Error(commit.stderr || commit.stdout || "Commit failed.");
  }

  const push = await run("git", ["push"], projectPath);
  if (!push.ok) {
    throw new Error(push.stderr || push.stdout || "Push failed.");
  }

  return {
    blocked: false,
    changed: true,
    csvCopies,
    scan,
    output: [commit.stdout, push.stdout || push.stderr].filter(Boolean).join("\n")
  };
}

async function createGithubRepository(projectName, options = {}) {
  if (options.confirmed !== true) {
    throw new Error("Confirmation is required before creating a GitHub repository.");
  }

  const projectPath = resolveProjectPath(projectName);
  const visibility = options.visibility === "public" ? "public" : "private";
  const repoName = sanitizeRepoName(options.repoName || projectName);
  if (!repoName) {
    throw new Error("A valid repository name is required.");
  }

  const githubStatus = await getGithubStatus();
  if (!githubStatus.loggedIn) {
    throw new Error("GitHub CLI is not logged in. Run gh auth login first.");
  }

  const privacy = privacyOptionsWithDefaults(options);
  await ensureGitignore(projectName, privacy.ignoreRules);
  const csvCopies = await preparePublicCsvCopies(projectName, privacy.csvPrivatePaths);
  const scan = await scanSensitiveInfo(projectName);
  if (!scan.safe) {
    return {
      blocked: true,
      created: false,
      scan,
      output: "GitHub repo creation blocked by the sensitive-info scan."
    };
  }

  if (!(await pathExists(path.join(projectPath, ".git")))) {
    const init = await initializeRepository(projectName, privacy);
    if (init.blocked) {
      return { ...init, created: false };
    }
  }

  const existingRemote = await run("git", ["remote", "get-url", "origin"], projectPath);
  if (existingRemote.ok) {
    throw new Error("This project already has an origin remote configured.");
  }

  const status = await run("git", ["status", "--short"], projectPath);
  if (status.stdout) {
    await run("git", ["add", "--all"], projectPath);
    const commit = await run("git", ["commit", "-m", options.message || "Initial project backup"], projectPath);
    if (!commit.ok) {
      throw new Error(commit.stderr || commit.stdout || "Initial commit failed.");
    }
  }

  const args = [
    "repo",
    "create",
    repoName,
    `--${visibility}`,
    "--source",
    ".",
    "--remote",
    "origin",
    "--push"
  ];

  const create = await run("gh", args, projectPath);
  if (!create.ok) {
    throw new Error(create.stderr || create.stdout || "GitHub repo creation failed.");
  }

  return {
    blocked: false,
    created: true,
    repoName,
    visibility,
    csvCopies,
    scan,
    output: create.stdout || create.stderr || `Created ${visibility} GitHub repository ${repoName}.`
  };
}

async function setStartup(enabled) {
  if (!process.env.APPDATA) {
    throw new Error("Windows startup folder was not found.");
  }

  if (!enabled) {
    if (await pathExists(STARTUP_SCRIPT)) {
      await fs.unlink(STARTUP_SCRIPT);
    }
    return { enabled: false };
  }

  const script = [
    "@echo off",
    `cd /d "${ROOT_DIR}"`,
    "start \"Auto Github Push\" /min npm run app"
  ].join("\r\n");

  await fs.mkdir(path.dirname(STARTUP_SCRIPT), { recursive: true });
  await fs.writeFile(STARTUP_SCRIPT, script, "utf8");
  return { enabled: true };
}

module.exports = {
  approveSensitiveFinding,
  commitAndPush,
  createGithubRepository,
  ensureGitignore,
  getGithubStatus,
  getPrivacyReview,
  getProjectStatus,
  initializeRepository,
  listProjects,
  openFindingInVsCode,
  openInVsCode,
  preparePublicCsvCopies,
  scanSensitiveInfo,
  setStartup
};
