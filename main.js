const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const {
  approveSensitiveFinding,
  commitAndPush,
  createGithubRepository,
  ensureGitignore,
  getGithubStatus,
  getPrivacyReview,
  initializeRepository,
  listProjects,
  openFindingInVsCode,
  openInVsCode,
  scanSensitiveInfo,
  setStartup
} = require("./project-service");

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: "Auto Github Push",
    backgroundColor: "#f6f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("projects:list", () => listProjects());
  ipcMain.handle("github:status", () => getGithubStatus());
  ipcMain.handle("project:open-vscode", (_event, projectName) => openInVsCode(projectName));
  ipcMain.handle("project:open-finding", (_event, payload) => (
    openFindingInVsCode(payload.projectName, payload.path, payload.line)
  ));
  ipcMain.handle("project:gitignore", (_event, payload) => (
    typeof payload === "string"
      ? ensureGitignore(payload)
      : ensureGitignore(payload.projectName, payload.ignoreRules)
  ));
  ipcMain.handle("project:privacy-review", (_event, projectName) => getPrivacyReview(projectName));
  ipcMain.handle("project:scan-sensitive", (_event, projectName) => scanSensitiveInfo(projectName));
  ipcMain.handle("project:approve-finding", (_event, payload) => (
    approveSensitiveFinding(payload.projectName, payload.findingId)
  ));
  ipcMain.handle("project:initialize", (_event, payload) => (
    typeof payload === "string"
      ? initializeRepository(payload)
      : initializeRepository(payload.projectName, payload.privacy)
  ));
  ipcMain.handle("project:create-github", (_event, payload) => (
    createGithubRepository(payload.projectName, payload)
  ));
  ipcMain.handle("project:commit-push", (_event, payload) => (
    commitAndPush(payload.projectName, payload.message, payload.confirmed, payload.privacy)
  ));
  ipcMain.handle("startup:set", (_event, enabled) => setStartup(enabled));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
