const { contextBridge, ipcRenderer } = require('electron');

console.log('✅ PRELOAD START (stable)');

/* ✅ SINGLE SOURCE OF IPC CONTRACT */
contextBridge.exposeInMainWorld('api', {
  /* =============================
     CONFIG
  ============================= */
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  clearConfig: () => ipcRenderer.invoke('config:clear'),

  /* =============================
     GITHUB
  ============================= */
  fetchPullRequestDiff: (payload) =>
    ipcRenderer.invoke('pr:fetchDiff', payload),

  verifyGitHubToken: (token) =>
    ipcRenderer.invoke('github:verify', token),

  /* =============================
     LLM
  ============================= */
  runAIReview: (payload) =>
    ipcRenderer.invoke('review:run', payload),

  verifyLLMConfig: (llm) =>
    ipcRenderer.invoke('llm:verify', llm),

  /* =============================
     REPOSITORY
  ============================= */
  listPullRequests: (payload) =>
    ipcRenderer.invoke('repo:listPullRequests', payload),

  getPullRequestDetails: (payload) =>
    ipcRenderer.invoke('repo:getPullRequestDetails', payload),
	
  generateFix: (payload) => ipcRenderer.invoke("fix:generate", payload),	
  
  getFileContent: (payload) => ipcRenderer.invoke("file:getContent", payload),

  /* =============================
     DEBUG (OPTIONAL)
  ============================= */
  ping: () => ipcRenderer.invoke('app:ping')
});
