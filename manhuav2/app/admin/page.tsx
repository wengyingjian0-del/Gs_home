import { env } from "@/lib/runtime-env";
import { cookies } from "next/headers";
import Link from "next/link";
import { ADMIN_COOKIE, adminSessionIsValid, getAdminAccessToken } from "@/lib/admin-auth";
import { AdminLogin, AdminLogout } from "./admin-login";

export const dynamic = "force-dynamic";

type StoredCandidate = { key: string; uploaded: Date; customMetadata?: Record<string, string> };
type ArtworkBucket = { list(options?: { prefix?: string; limit?: number; include?: ("customMetadata")[] }): Promise<{ objects: StoredCandidate[] }> };
type Batch = { id: string; uploaded: Date; reason: string; candidates: StoredCandidate[]; totalMs: number; rescueTriggered: boolean; legacy: boolean; final?: StoredCandidate };

function parseScore(candidate: StoredCandidate) {
  try { return JSON.parse(candidate.customMetadata?.scores || "{}") as { intent?: number; character?: number; quality?: number; safety?: number }; }
  catch { return {} as { intent?: number; character?: number; quality?: number; safety?: number }; }
}

function stageOrder(candidate: StoredCandidate) {
  const stage = candidate.customMetadata?.stage;
  const round = Number(candidate.customMetadata?.round || 0);
  const draftIndex = Number(candidate.key.match(/-r1-(\d+)\.png$/)?.[1] || 0);
  return round * 10 + (stage === "draft" ? draftIndex : 0);
}

function formatDuration(ms: number) {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function statusOf(batch: Batch) {
  if (!batch.final) return { label: "未通过", className: "failed" };
  if (batch.legacy) return { label: "旧版两候选", className: "legacy" };
  if (batch.rescueTriggered) return { label: "补救后完成", className: "rescued" };
  return { label: "三轮完成", className: "complete" };
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const token = getAdminAccessToken();
  const cookieStore = await cookies();
  if (!await adminSessionIsValid(cookieStore.get(ADMIN_COOKIE)?.value)) return <AdminLogin configured={Boolean(token)} />;

  const bucket = (env as unknown as { ARTWORKS?: ArtworkBucket }).ARTWORKS;
  const objects = bucket ? (await bucket.list({ prefix: "generated/", limit: 1000, include: ["customMetadata"] })).objects : [];
  const batchMap = new Map<string, Batch>();
  for (const object of objects) {
    const id = object.customMetadata?.batchId;
    if (!id) continue;
    const batch = batchMap.get(id) || { id, uploaded: object.uploaded, reason: object.customMetadata?.reason || "", candidates: [], totalMs: Number(object.customMetadata?.totalMs || 0), rescueTriggered: false, legacy: false };
    batch.candidates.push(object);
    if (object.uploaded > batch.uploaded) batch.uploaded = object.uploaded;
    if (object.customMetadata?.reason) batch.reason = object.customMetadata.reason;
    batch.totalMs = Math.max(batch.totalMs, Number(object.customMetadata?.totalMs || 0));
    if (object.customMetadata?.stage === "rescue") batch.rescueTriggered = true;
    if (!object.customMetadata?.stage) batch.legacy = true;
    if (object.customMetadata?.finalSelected === "true" || (!object.customMetadata?.stage && object.customMetadata?.selected === "true")) batch.final = object;
    batchMap.set(id, batch);
  }

  const allBatches = [...batchMap.values()].map(batch => ({ ...batch, candidates: batch.candidates.sort((a, b) => stageOrder(a) - stageOrder(b)) })).sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
  const view = (await searchParams).view || "all";
  const batches = allBatches.filter(batch => view === "all" || (view === "rescue" ? batch.rescueTriggered : view === "failed" ? !batch.final : Boolean(batch.final)));
  const completed = allBatches.filter(batch => batch.final).length;
  const rescued = allBatches.filter(batch => batch.rescueTriggered).length;
  const averageMs = completed ? Math.round(allBatches.filter(batch => batch.final).reduce((sum, batch) => sum + batch.totalMs, 0) / completed) : 0;

  return <main className="admin-shell">
    <header className="admin-header">
      <div className="admin-brand"><span className="admin-brand-mark">HY</span><div><span>HUAYA / CONTROL ROOM</span><h1>多轮优化管理台</h1></div></div>
      <div className="admin-header-actions"><Link href="/">创作端 ↗</Link><AdminLogout /></div>
    </header>

    <section className="admin-security-note"><b>受控内容区</b><span>中间图仅供质量复核。请勿下载、传播或长期保留被拒绝的儿童创作候选。</span></section>

    <section className="admin-metrics" aria-label="生成质量概览">
      <article><span>优化任务</span><strong>{allBatches.length}</strong><small>已记录批次</small></article>
      <article><span>最终完成</span><strong>{completed}</strong><small>{allBatches.length ? `${Math.round(completed / allBatches.length * 100)}% 完成率` : "暂无样本"}</small></article>
      <article><span>触发补救</span><strong>{rescued}</strong><small>精修未达门槛</small></article>
      <article><span>平均耗时</span><strong>{formatDuration(averageMs)}</strong><small>只统计完成任务</small></article>
    </section>

    <nav className="admin-filters" aria-label="任务筛选">
      <a className={view === "all" ? "active" : ""} href="/admin?view=all">全部 <em>{allBatches.length}</em></a>
      <a className={view === "complete" ? "active" : ""} href="/admin?view=complete">已完成 <em>{completed}</em></a>
      <a className={view === "rescue" ? "active" : ""} href="/admin?view=rescue">触发补救 <em>{rescued}</em></a>
      <a className={view === "failed" ? "active" : ""} href="/admin?view=failed">未通过 <em>{allBatches.length - completed}</em></a>
    </nav>

    {!bucket && <div className="admin-empty"><b>对象存储尚未连接</b><p>连接 ARTWORKS R2 后，多轮候选和评审记录会显示在这里。</p></div>}
    {bucket && !batches.length && <div className="admin-empty"><b>当前筛选下没有任务</b><p>完成一次新生成后即可查看“理解 → 初稿 → 精修 → 补救”的完整链路。</p></div>}

    <section className="admin-batches">
      {batches.map(batch => {
        const status = statusOf(batch);
        const rounds = new Map<number, StoredCandidate[]>();
        batch.candidates.forEach(candidate => {
          const round = Number(candidate.customMetadata?.round || 1);
          rounds.set(round, [...(rounds.get(round) || []), candidate]);
        });
        return <article className="admin-batch" key={batch.id}>
          <div className="admin-batch-title">
            <div><span className={`admin-status ${status.className}`}>{status.label}</span><strong>{batch.uploaded.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</strong><small>任务 {batch.id} · {formatDuration(batch.totalMs)}</small></div>
            <a href={`#${batch.id}`}>链路记录 #{batch.id.slice(0, 8)}</a>
          </div>

          {batch.legacy ? <div className="admin-legacy-note">该任务生成于多轮优化上线之前，仅包含两张候选与一次评审。</div> : <ol className="admin-timeline" aria-label="优化流程">
            <li className="done"><i>01</i><div><b>理解需求</b><small>安全检查与 VisualSpec</small></div></li>
            <li className="done"><i>02</i><div><b>初稿竞争</b><small>2 张候选自动择优</small></div></li>
            <li className={rounds.has(2) ? "done" : "pending"}><i>03</i><div><b>定向精修</b><small>保持锁定项，只修问题</small></div></li>
            <li className={rounds.has(3) ? "done rescue" : "skipped"}><i>04</i><div><b>按需补救</b><small>{rounds.has(3) ? "已触发最后补强" : "质量达标，已跳过"}</small></div></li>
          </ol>}

          {[...rounds.entries()].map(([round, candidates]) => <section className="admin-round" key={round}>
            <div className="admin-round-heading"><div><span>ROUND {String(round).padStart(2, "0")}</span><h2>{candidates[0]?.customMetadata?.stageLabel || `第 ${round} 轮`}</h2></div><small>耗时 {formatDuration(Number(candidates[0]?.customMetadata?.durationMs || 0))}</small></div>
            <div className={`admin-grid count-${candidates.length}`}>
              {candidates.map((candidate, index) => {
                const final = candidate.customMetadata?.finalSelected === "true";
                const selectedDraft = candidate.customMetadata?.stage === "draft" && candidate.customMetadata?.selected === "true";
                const score = parseScore(candidate);
                return <figure className={final ? "final" : selectedDraft ? "selected" : "intermediate"} key={candidate.key}>
                  <a href={`/api/images/${candidate.key.slice("generated/".length)}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/images/${candidate.key.slice("generated/".length)}`} alt={`第 ${round} 轮候选 ${index + 1}`} />
                  </a>
                  <figcaption><b>{candidate.customMetadata?.stage === "draft" ? `初稿 ${String.fromCharCode(65 + index)}` : candidate.customMetadata?.stage === "rescue" ? "补救稿" : "精修稿"}</b>{final ? <em>最终交付</em> : selectedDraft ? <mark>入选初稿</mark> : <span>过程图</span>}</figcaption>
                  <div className="candidate-scores"><span><i>安全</i><b>{score.safety ?? "—"}</b></span><span><i>意图</i><b>{score.intent ?? "—"}</b></span><span><i>角色</i><b>{score.character ?? "—"}</b></span><span><i>画质</i><b>{score.quality ?? "—"}</b></span></div>
                </figure>;
              })}
            </div>
          </section>)}
          {batch.reason && <p className="admin-reason"><b>最终评审备注</b><span>{batch.reason}</span></p>}
        </article>;
      })}
    </section>
  </main>;
}
