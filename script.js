const statusEl = document.querySelector("#deploy-status");

if (statusEl) {
  const now = new Date();
  statusEl.textContent = `更多产品正在打磨中 · 最后更新：${now.toLocaleString("zh-CN")}`;
}