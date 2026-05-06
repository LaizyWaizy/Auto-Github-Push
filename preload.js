const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("autoGithubPush", {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  getGithubStatus: () => ipcRenderer.invoke("github:status"),
  openInVsCode: (projectName) => ipcRenderer.invoke("project:open-vscode", projectName),
  openFindingInVsCode: (payload) => ipcRenderer.invoke("project:open-finding", payload),
  ensureGitignore: (payload) => ipcRenderer.invoke("project:gitignore", payload),
  getPrivacyReview: (projectName) => ipcRenderer.invoke("project:privacy-review", projectName),
  scanSensitiveInfo: (projectName) => ipcRenderer.invoke("project:scan-sensitive", projectName),
  approveSensitiveFinding: (payload) => ipcRenderer.invoke("project:approve-finding", payload),
  initializeRepository: (projectName) => ipcRenderer.invoke("project:initialize", projectName),
  createGithubRepository: (payload) => ipcRenderer.invoke("project:create-github", payload),
  commitAndPush: (payload) => ipcRenderer.invoke("project:commit-push", payload),
  setStartup: (enabled) => ipcRenderer.invoke("startup:set", enabled)
});
