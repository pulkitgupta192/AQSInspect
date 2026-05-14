const keytar = require("keytar");

const SERVICE = "AQSInspect";
const ACCOUNT = "user-config";

async function saveConfig({ token, user }) {
  const value = JSON.stringify({ token, user });
  await keytar.setPassword(SERVICE, ACCOUNT, value);
}

async function loadConfig() {
  const value = await keytar.getPassword(SERVICE, ACCOUNT);
  return value ? JSON.parse(value) : null;
}

async function clearConfig() {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}

module.exports = {
  saveConfig,
  loadConfig,
  clearConfig
};