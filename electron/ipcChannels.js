console.log("✅ ipcChannels.js loaded");

const IPC_CHANNELS = {
  PING: "app:ping",
  FETCH_PR_DIFF: "github:fetch-pr-diff"
};

module.exports = {
  GET_CONFIG: 'get-config',
  SAVE_CONFIG: 'save-config',
  RUN_LLM_REVIEW: 'run-llm-review',
  LIST_PULL_REQUESTS: "listPullRequests",
  GET_PULL_REQUEST_DETAILS: "getPullRequestDetails"  
};