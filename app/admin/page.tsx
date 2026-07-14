import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type StoredCandidate = {
  key: string;
  uploaded: Date;
  customMetadata?: Record<string, string>;
};

type ArtworkBucket = {
  list(options?: { prefix?: string; limit?: number; include?: ("customMetadata")[] }): Promise<{ objects: StoredCandidate[] }>;
};

type Batch = {
  id: string;
  uploaded: Date;
  reason: string;
  candidates: StoredCandidate[];
};

export default async function AdminPage() {
  const bucket = (env as unknown as { ARTWORKS?: ArtworkBucket }).ARTWORKS;
  const objects = bucket
    ? (await bucket.list({ prefix: "generated/", limit: 1000, include: ["customMetadata"] })).objects
    : [];

  const batchMap = new Map<string, Batch>();
  for (const object of objects) {
    const id = object.customMetadata?.batchId;
    if (!id) continue;
    const batch = batchMap.get(id) || {
      id,
      uploaded: object.uploaded,
      reason: object.customMetadata?.reason || "",
      candidates: [],
    };
    batch.candidates.push(object);
    if (object.uploaded > batch.uploaded) batch.uploaded = object.uploaded;
    batchMap.set(id, batch);
  }

  const batches = [...batchMap.values()]
    .map(batch => ({ ...batch, candidates: batch.candidates.sort((a, b) => Number(a.customMetadata?.candidateIndex) - Number(b.customMetadata?.candidateIndex)) }))
    .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><span>创作管理</span><h1>候选图片库</h1></div>
        <a href="/">返回创作端</a>
      </header>
      <p className="admin-summary">共 {batches.length} 次生成 · 每组保留全部 4 张候选图</p>
      {!bucket && <div className="admin-empty">图片存储尚未连接，连接后生成的候选图会显示在这里。</div>}
      {bucket && batches.length === 0 && <div className="admin-empty">还没有完整候选组。下一次生成后，4 张图片会一起出现在这里。</div>}
      <section className="admin-batches">
        {batches.map(batch => (
          <article className="admin-batch" key={batch.id}>
            <div className="admin-batch-title">
              <div><strong>{batch.uploaded.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</strong><small>批次 {batch.id.slice(0, 8)}</small></div>
              <span>{batch.candidates.length}/4 张</span>
            </div>
            <div className="admin-grid">
              {batch.candidates.map((candidate, index) => {
                const selected = candidate.customMetadata?.selected === "true";
                const rejected = candidate.customMetadata?.reviewStatus === "rejected";
                let score: { intent?: number; character?: number; quality?: number; safety?: number } = {};
                try { score = JSON.parse(candidate.customMetadata?.scores || "{}"); } catch { score = {}; }
                return <figure className={selected ? "selected" : rejected ? "rejected" : ""} key={candidate.key}>
                  <a href={`/api/images/${candidate.key.slice("generated/".length)}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/images/${candidate.key.slice("generated/".length)}`} alt={`候选图 ${index + 1}`} />
                  </a>
                  <figcaption><b>候选 {index + 1}</b>{selected ? <em>AI 已选</em> : <span>未入选</span>}</figcaption>
                  <div className="candidate-scores"><span>安全 {score.safety ?? "—"}</span><span>角色 {score.character ?? "—"}</span><span>画质 {score.quality ?? "—"}</span><span>意图 {score.intent ?? "—"}</span></div>
                </figure>;
              })}
            </div>
            {batch.reason && <p className="admin-reason"><b>评选理由：</b>{batch.reason}</p>}
          </article>
        ))}
      </section>
    </main>
  );
}
