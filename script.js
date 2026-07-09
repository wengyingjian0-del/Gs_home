const statusEl = document.querySelector("#deploy-status");

if (statusEl) {
  const now = new Date();
  statusEl.textContent = `页面文件已准备完成。本地生成时间：${now.toLocaleString("zh-CN")}`;
}
