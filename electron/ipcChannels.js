console.log("✅ ipcChannels.js loaded");

const IPC_CHANNELS = {
  PING: "app:ping",
  FETCH_PR_DIFF: "github:fetch-pr-diff"
};

module.exports = { IPC_CHANNELS };