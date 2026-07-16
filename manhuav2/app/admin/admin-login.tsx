"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export function AdminLogin({ configured }: { configured: boolean }) {
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!configured || !accessCode.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessCode }) });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "无法进入管理后台。");
      }
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法进入管理后台。");
    } finally { setBusy(false); }
  }

  return <main className="admin-login-shell">
    <section className="admin-login-card">
      <div className="admin-login-mark">HY</div>
      <span className="admin-eyebrow">HUAYA / CONTROL ROOM</span>
      <h1>多轮优化管理台</h1>
      <p>这里包含儿童创作的中间候选、审核结果和模型诊断，只允许授权管理员访问。</p>
      {configured ? <form onSubmit={submit}>
        <label>管理员访问口令<input type="password" autoComplete="current-password" value={accessCode} onChange={event => setAccessCode(event.target.value)} placeholder="输入服务端配置的口令" /></label>
        {error && <div className="admin-login-error">{error}</div>}
        <button disabled={busy || !accessCode.trim()}>{busy ? "正在验证…" : "进入控制台"}</button>
      </form> : <div className="admin-setup-note"><b>入口尚未启用</b><p>请在服务端环境变量中设置 <code>ADMIN_ACCESS_TOKEN</code>，然后重新启动应用。</p></div>}
      <Link href="/">← 返回儿童创作端</Link>
    </section>
  </main>;
}

export function AdminLogout() {
  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    window.location.reload();
  }
  return <button className="admin-logout" onClick={logout}>安全退出</button>;
}
