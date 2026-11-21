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
  if (message.type !== "discard") throw new Error("未知操作。");
  const { windowId, tabId, groupId } = message;
  const validTarget = (Number.isInteger(tabId) && groupId === undefined) ||
    (Number.isInteger(groupId) && groupId >= 0 && tabId === undefined);
  if (!Number.isInteger(windowId) || !validTarget) throw new Error("找不到目标标签页或标签组。");
  if (discardInProgress) throw new Error("已有卸载操作正在执行。");
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
    console.warn("无法设置标签页快照定时任务，请检查 Telegraf 配置。");
  }).finally(() => { alarmSync = undefined; });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
