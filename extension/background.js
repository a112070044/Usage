// 把 content script 回報的剩餘百分比顯示在工具列圖示的徽章上。
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'usage') return;
  const tabId = sender.tab?.id;
  const opts = tabId === undefined ? {} : { tabId };
  chrome.action.setBadgeText({ ...opts, text: msg.text ?? '' });
  chrome.action.setBadgeBackgroundColor({ ...opts, color: msg.color ?? '#6b7280' });
  if (msg.title) chrome.action.setTitle({ ...opts, title: msg.title });
});
