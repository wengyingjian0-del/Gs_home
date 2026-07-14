import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { buildGenerationPrompt, buildQueryContext, callWan, decodeGenerationContext, encodeGenerationContext, evaluateCandidates, GenerateInput, getRuntimeConfig, rewriteQueryWithContext, validateChildSafeInput } from "@/lib/generation";

type ArtworkBucket = { put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>; get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null> };
type Bindings = { ARTWORKS?: ArtworkBucket };

export async function POST(request: Request) {
  let input: GenerateInput;
  try { input = await request.json() as GenerateInput; }
  catch { return Response.json({ message: "我没有读懂这次选择，请返回再选一次。" }, { status: 400 }); }

  const validation = validateChildSafeInput(input);
  if (!validation.ok) return Response.json({ message: validation.message }, { status: 422 });
  if (input.extraDescription) {
    input = { ...input, extraDescription: input.extraDescription
      .replace(/([一二三四五六七八九十\d]+)个?月大(?:的)?女?宝宝/g, "虚构的低龄卡通小女孩（非真人、非照片）")
      .replace(/([一二三四五六七八九十\d]+)岁(?:的)?小?孩(?:子)?/g, "虚构的儿童卡通角色（非真人、非照片）") };
  }
  if (input.editIntent && !["emotion", "action", "background", "extra"].includes(input.editIntent)) return Response.json({ message: "暂时不能做这种修改，请从表情、动作、背景或细节中选择。" }, { status: 400 });
  const queryContext = buildQueryContext(input);
  const config = getRuntimeConfig();

  if (!config) return Response.json({
    code: "MODEL_NOT_CONFIGURED",
    message: "模型服务尚未配置：本次没有调用万相，也没有生成图片。请先在服务端配置新的百炼 API Key。",
  }, { status: 503 });

  try {
    const bindings = env as unknown as Bindings;
    let referenceDataUrl: string | undefined;
    let previousContext: string | undefined;
    if (input.referenceKey) {
      if (!/^generated\/[a-zA-Z0-9/_-]+\.png$/.test(input.referenceKey)) return Response.json({ message: "只能引用作品中心里的一张历史图片。" }, { status: 400 });
      const reference = await bindings.ARTWORKS?.get(input.referenceKey);
      if (!reference) return Response.json({ message: "没有找到这张历史图片，请重新选择。" }, { status: 404 });
      referenceDataUrl = `data:${reference.httpMetadata?.contentType || "image/png"};base64,${Buffer.from(await reference.arrayBuffer()).toString("base64")}`;
      previousContext = decodeGenerationContext(reference.customMetadata?.generationContext);
      if (!previousContext && reference.customMetadata?.contextKey) {
        const contextObject = await bindings.ARTWORKS?.get(reference.customMetadata.contextKey);
        if (contextObject) {
          try {
            const stored = JSON.parse(Buffer.from(await contextObject.arrayBuffer()).toString("utf8")) as { generationContext?: string };
            previousContext = decodeGenerationContext(stored.generationContext);
          } catch { previousContext = undefined; }
        }
      }
    }

    const rewrite = await rewriteQueryWithContext(config, queryContext, { referenceDataUrl, previousContext, editIntent: input.editIntent });
    const generationPrompt = buildGenerationPrompt(input, rewrite.rewrittenPrompt);
    const candidates = await callWan(config, generationPrompt, referenceDataUrl);
    const evaluation = await evaluateCandidates(config, generationPrompt, candidates);
    const selectedUrl = evaluation.selectedIndex >= 0 ? candidates[evaluation.selectedIndex] : undefined;
    const batchId = crypto.randomUUID();
    const key = evaluation.selectedIndex >= 0 ? `generated/${batchId}-${evaluation.selectedIndex + 1}.png` : undefined;
    if (bindings.ARTWORKS) {
      const contextKey = `contexts/${batchId}.json`;
      const contextDocument = JSON.stringify({
        version: 1,
        batchId,
        generationContext: encodeGenerationContext(input),
        input,
        rewrite: { changedFields: rewrite.changedFields, lockedFields: rewrite.lockedFields },
        evaluation,
        createdAt: new Date().toISOString(),
      });
      const contextBytes = new TextEncoder().encode(contextDocument);
      await bindings.ARTWORKS.put(contextKey, contextBytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "application/json" } });
      const candidateResponses = await Promise.all(candidates.map(url => fetch(url)));
      if (candidateResponses.some(response => !response.ok)) throw new Error("候选作品保存失败");
      await Promise.all(candidateResponses.map(async (response, index) => {
        const candidateKey = `generated/${batchId}-${index + 1}.png`;
        const score = evaluation.scores?.find(item => item.index === index);
        await bindings.ARTWORKS!.put(candidateKey, await response.arrayBuffer(), {
          httpMetadata: { contentType: response.headers.get("content-type") || "image/png" },
          customMetadata: {
            batchId,
            candidateIndex: String(index),
            selected: String(index === evaluation.selectedIndex),
            reviewStatus: evaluation.selectedIndex >= 0 ? "approved" : "rejected",
            contextKey,
            evaluator: config.visionModel,
            reason: evaluation.reason.slice(0, 180),
            scores: score ? JSON.stringify(score).slice(0, 300) : "",
          },
        });
      }));
      if (!key) return Response.json({ code: "ALL_CANDIDATES_REJECTED", message: `4张候选图都没有达到儿童安全阈值。评审原因：${evaluation.reason}`, batchId, evaluation }, { status: 422 });
      return Response.json({ mode: "live", imageUrl: `/api/images/${key.slice("generated/".length)}`, referenceKey: key, batchId, evaluation });
    }
    // Local development fallback: URLs expire, so production hosting must bind R2.
    if (!selectedUrl) return Response.json({ code: "ALL_CANDIDATES_REJECTED", message: `4张候选图都没有达到儿童安全阈值。评审原因：${evaluation.reason}`, batchId, evaluation }, { status: 422 });
    return Response.json({ mode: "live-temporary", imageUrl: selectedUrl, referenceKey: null, batchId, evaluation });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "生成服务刚刚走神了，本次不会保存，请再试一次。";
    return Response.json({ message }, { status: 502 });
  }
}
