import { config } from "./config.js";
import { discardTabs } from "./tabs.js";
import { endpoint, sendSnapshot } from "./telemetry.js";

const alarmName = "edge-tab-snapshot";
let discardInProgress = false;

async function syncAlarm() {
  if (!endpoint()) {
    await chrome.alarms.clear(alarmName);
    return;
  }
  const alarm = await chrome.alarms.get(alarmName);
  if (alarm?.periodInMinutes !== config.snapshotIntervalMinutes) {
    await chrome.alarms.create(alarmName, { periodInMinutes: config.snapshotIntervalMinutes });
  }
}

async function handleMessage(message) {
  if (message.type === "snapshot") return sendSnapshot();
  if (message.type !== "discard") throw new Error("Unknown action.");
  const { windowId, tabId, groupId } = message;
  const validTarget = (Number.isInteger(tabId) && groupId === undefined) ||
    (Number.isInteger(groupId) && groupId >= 0 && tabId === undefined);
  if (!Number.isInteger(windowId) || !validTarget) throw new Error("The target tab or group could not be found.");
  if (discardInProgress) throw new Error("A discard operation is already in progress.");
  discardInProgress = true;
  try {
    return await discardTabs(windowId, { tabId, groupId });
  } finally {
    discardInProgress = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(message).then(
    (result) => reply({ ok: true, result }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === alarmName) {
    sendSnapshot().catch((error) => console.warn(error.message));
  }
});

let alarmSync;
function ensureAlarm() {
  alarmSync ??= syncAlarm().catch(() => {
    console.warn("Could not schedule tab snapshots. Check the Telegraf configuration.");
  }).finally(() => { alarmSync = undefined; });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
