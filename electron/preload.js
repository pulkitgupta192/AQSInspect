const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ PRELOAD START (stable)");

contextBridge.exposeInMainWorld("api", {
  ping: () => ipcRenderer.invoke("app:ping"),
  
  reviewPullRequest: (payload) =>
		ipcRenderer.invoke("ai:review-pr", payload),
		
  fetchPullRequestDiff: (payload) => {
    if (!payload || typeof payload.prUrl !== "string") {
      throw new Error("prUrl is required");
    }
    if (typeof payload.token !== "string" || !payload.token.trim()) {
      throw new Error("token is required");
    }
    return ipcRenderer.invoke("github:fetch-pr-diff", payload);
  }
});

contextBridge.exposeInMainWorld("config", {
  get: () => ipcRenderer.invoke("config:get"),
  save: (config) => ipcRenderer.invoke("config:save", config),
  clear: () => ipcRenderer.invoke("config:clear")
});