export function tabAddress(rawAddress, includeQueryAndFragment) {
  try {
    const url = new URL(rawAddress);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    url.username = "";
    url.password = "";
    if (!includeQueryAndFragment) {
      url.search = "";
      url.hash = "";
    }
    return url.href;
  } catch {
    return null;
  }
}

function tabInfo(tab, includeQueryAndFragment = false) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    groupId: tab.groupId,
    address: tabAddress(tab.url, includeQueryAndFragment),
    activeInWindow: tab.active,
    lastAccessed: Number.isFinite(tab.lastAccessed) ? tab.lastAccessed : null,
    discarded: tab.discarded,
    pinned: tab.pinned,
    audible: tab.audible,
  };
}

export async function collectTabs(query = {}, includeQueryAndFragment = false) {
  const tabs = await chrome.tabs.query(query);
  return tabs.filter((tab) => !tab.incognito).map((tab) => tabInfo(tab, includeQueryAndFragment));
}

export function skipReason(tab) {
  if (!tab.address) return "非 HTTP(S) 或地址不可用";
  if (tab.activeInWindow) return "窗口当前标签页";
  if (tab.discarded) return "已卸载";
  if (tab.pinned) return "已固定";
  if (tab.audible) return "正在播放音频";
  return "";
}

export async function discardTabs(windowId, target) {
  const query = { windowId };
  if (target.groupId !== undefined) query.groupId = target.groupId;
  const candidates = await collectTabs(query);
  const selected = candidates.filter((tab) => target.tabId === undefined || tab.id === target.tabId);
  const result = { discarded: 0, failed: 0, skipped: 0, skipReasons: {} };

  for (const candidate of selected) {
    let tab;
    try {
      // 组操作可能在执行期间遇到关闭、移动或换组，按稳定的标签 ID 再确认。
      const current = await chrome.tabs.get(candidate.id);
      if (!current.incognito && current.windowId === windowId &&
          (target.groupId === undefined || current.groupId === target.groupId)) {
        tab = tabInfo(current);
      }
    } catch {
      tab = undefined;
    }
    const reason = tab ? skipReason(tab) : "标签页已关闭或移出范围";
    if (reason) {
      result.skipped++;
      result.skipReasons[reason] = (result.skipReasons[reason] ?? 0) + 1;
      continue;
    }
    try {
      const discarded = await chrome.tabs.discard(candidate.id);
      if (discarded?.discarded) result.discarded++;
      else result.failed++;
    } catch {
      result.failed++;
    }
  }
  if (!selected.length && target.tabId !== undefined) {
    result.skipped = 1;
    result.skipReasons["标签页已关闭或移出范围"] = 1;
  }
  return result;
}
