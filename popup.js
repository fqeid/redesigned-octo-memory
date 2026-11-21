import { config } from "./config.js";
import { endpoint } from "./telemetry.js";
import { collectTabs, skipReason } from "./tabs.js";

const group = document.querySelector("#group");
const summary = document.querySelector("#summary");
const body = document.querySelector("#tabs");
const notice = document.querySelector("#notice");
const discardGroup = document.querySelector("#discard-group");
const refresh = document.querySelector("#refresh");
const send = document.querySelector("#send");
const telemetryStatus = document.querySelector("#telemetry-status");
const uploadResult = document.querySelector("#upload-result");
const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

let windowId;
let tabs = [];
let groups = [];
let busy = false;

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "扩展后台未返回结果。");
  return response.result;
}

function addCell(row, value) {
  const cell = row.insertCell();
  cell.textContent = value;
  return cell;
}

function renderTabs() {
  const selection = group.value;
  const filtered = selection === "all" ? tabs : tabs.filter((tab) => String(tab.groupId) === selection);
  summary.textContent = `当前窗口 ${tabs.length} 个标签页 · ${tabs.filter((tab) => tab.discarded).length} 个已卸载`;
  discardGroup.disabled = busy || Number(selection) < 0 || selection === "all" ||
    !filtered.some((tab) => !skipReason(tab));
  refresh.disabled = busy;
  group.disabled = busy;
  body.replaceChildren();
  if (!filtered.length) {
    addCell(body.insertRow(), "没有匹配的标签页").colSpan = 4;
    return;
  }
  for (const tab of filtered) {
    const row = body.insertRow();
    const reason = skipReason(tab);
    addCell(row, tab.address ?? "—");
    addCell(row, reason || "后台已加载");
    addCell(row, tab.lastAccessed ? dateTime.format(tab.lastAccessed) : "—");
    const button = document.createElement("button");
    button.textContent = "卸载";
    button.disabled = busy || Boolean(reason);
    button.addEventListener("click", () => runDiscard({ tabId: tab.id }));
    row.insertCell().append(button);
  }
}

async function load() {
  windowId ??= (await chrome.windows.getCurrent()).id;
  const selection = group.value;
  [tabs, groups] = await Promise.all([
    collectTabs({ windowId }, config.includeQueryAndFragment),
    chrome.tabGroups.query({ windowId }),
  ]);
  group.replaceChildren(new Option("全部标签页", "all"));
  if (tabs.some((tab) => tab.groupId === -1)) group.add(new Option("未分组", "-1"));
  for (const item of groups) {
    const count = tabs.filter((tab) => tab.groupId === item.id).length;
    group.add(new Option(`${item.title || "未命名标签组"}（${count}）`, String(item.id)));
  }
  if (Array.from(group.options).some((option) => option.value === selection)) {
    group.value = selection;
  }
  renderTabs();
}

async function runDiscard(target) {
  busy = true;
  renderTabs();
  notice.textContent = "正在卸载…";
  try {
    const result = await request({ type: "discard", windowId, ...target });
    const details = Object.entries(result.skipReasons).map(([reason, count]) => `${reason} ${count}`);
    notice.textContent = `已卸载 ${result.discarded} 个，跳过 ${result.skipped} 个，失败 ${result.failed} 个。` +
      (details.length ? `（${details.join("、")}）` : "");
    try {
      await load();
    } catch {
      notice.textContent += " 列表刷新失败，请手动刷新。";
    }
  } catch (error) {
    notice.textContent = error.message;
  } finally {
    busy = false;
    renderTabs();
  }
}

group.addEventListener("change", renderTabs);
discardGroup.addEventListener("click", () => runDiscard({ groupId: Number(group.value) }));
refresh.addEventListener("click", () => {
  notice.textContent = "";
  load().catch((error) => { notice.textContent = error.message; });
});

try {
  if (endpoint()) {
    telemetryStatus.textContent = `Telegraf 已配置 · 每 ${config.snapshotIntervalMinutes} 分钟上报`;
    send.disabled = false;
  } else {
    telemetryStatus.textContent = "Telegraf 未配置 · 仅本地查看";
  }
} catch (error) {
  telemetryStatus.textContent = error.message;
}

send.addEventListener("click", async () => {
  send.disabled = true;
  uploadResult.hidden = false;
  uploadResult.textContent = "正在上报…";
  try {
    const result = await request({ type: "snapshot" });
    uploadResult.textContent = result.status === "sent" ? `已上报 ${result.count} 个标签页。` :
      result.status === "empty" ? "没有可上报的 HTTP(S) 标签页。" : "Telegraf 未配置。";
  } catch (error) {
    uploadResult.textContent = error.message;
  } finally {
    send.disabled = false;
  }
});

load().catch((error) => { summary.textContent = error.message; });
