import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { buildGenerationPrompt, buildQueryContext, buildRefinementPrompt, buildVisualDescription, callWan, decodeGenerationContext, encodeGenerationContext, evaluateCandidates, GenerateInput, getRuntimeConfig, inferCharacterKind, inferEditIntent, rewriteQueryWithContext, validateChildSafeInput } from "@/lib/generation";
import { GenerationTimeoutError, isTimeoutLikeError, remainingGenerationMs, runTimedStage } from "@/lib/generation-timeout";

type ArtworkBucket = { put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>; get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null> };
type Bindings = { ARTWORKS?: ArtworkBucket };
type Score = { index: number; intent: number; character: number; quality: number; safety: number };
type Evaluation = { selectedIndex: number; safe: boolean; reason: string; scores?: Score[] };
type PipelineImage = { url: string; key: string; stage: "draft" | "refinement" | "rescue"; round: number; stageLabel: string; durationMs: number; score?: Score; evaluationReason: string };

// 历史成功四轮任务约 84 秒；保留约 2 倍余量应对服务波动，同时避免无限等待。
const TOTAL_GENERATION_MS = 175_000;
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scoreAt(evaluation: Evaluation, index: number) {
  return evaluation.scores?.find(item => item.index === index);
}

function qualityNeedsRescue(score?: Score) {
  return !score || score.intent < 82 || score.quality < 78 || score.safety < 85 || score.character < 72;
}

async function fetchImage(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("优化过程图片保存失败");
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "image/png" };
}

async function updateJob(bucket: ArtworkBucket | undefined, batchId: string, stage: string, label: string, extra: Record<string, unknown> = {}) {
  if (!bucket) return;
  const bytes = new TextEncoder().encode(JSON.stringify({ batchId, status: stage === "completed" ? "completed" : stage === "failed" ? "failed" : "running", stage, label, updatedAt: new Date().toISOString(), ...extra }));
  try {
    await Promise.race([
      bucket.put(`jobs/${batchId}.json`, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "application/json" } }),
      new Promise(resolve => setTimeout(resolve, 800)),
    ]);
  } catch { /* 进度记录失败不应阻断生图 */ }
}

async function readJob(bucket: ArtworkBucket | undefined, batchId: string) {
  if (!bucket) return undefined;
  try {
    const object = await Promise.race([
      bucket.get(`jobs/${batchId}.json`),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 800)),
    ]);
    if (!object) return undefined;
    return JSON.parse(Buffer.from(await object.arrayBuffer()).toString("utf8")) as { stage?: string; label?: string; attempt?: number; maxAttempts?: number };
  } catch { return undefined; }
}

function stageOptions(bucket: ArtworkBucket | undefined, batchId: string, deadline: number, stage: string, label: string, attemptTimeoutMs: number, reserveMs: number, retries = 1) {
  return {
    stage,
    deadline,
    attemptTimeoutMs,
    reserveMs,
    retries,
    onAttempt: (attempt: number, maxAttempts: number) => updateJob(bucket, batchId, stage, attempt > 1 ? `${label}，上次超时，正在自动重试` : label, { attempt, maxAttempts }),
  };
}

export async function POST(request: Request) {
  let input: GenerateInput;
  try { input = await request.json() as GenerateInput; }
  catch { return Response.json({ message: "我没有读懂这次选择，请返回再选一次。" }, { status: 400 }); }

  const validation = validateChildSafeInput(input);
  if (!validation.ok) return Response.json({ code: validation.code, message: validation.message, canContinue: validation.canContinue, missingFields: validation.missingFields }, { status: 422 });
  if (input.extraDescription) {
    input = { ...input, extraDescription: input.extraDescription
      .replace(/([一二三四五六七八九十\d]+)个?月大(?:的)?女?宝宝/g, "虚构的低龄卡通小女孩（非真人、非照片）")
      .replace(/([一二三四五六七八九十\d]+)岁(?:的)?小?孩(?:子)?/g, "虚构的儿童卡通角色（非真人、非照片）") };
  }
  if (input.editIntent && !["emotion", "action", "background", "extra"].includes(input.editIntent)) return Response.json({ message: "暂时不能做这种修改，请从表情、动作、背景或细节中选择。" }, { status: 400 });
  input = { ...input, referenceKey: input.compositionMode === "scene-only" ? undefined : input.referenceKey, editIntent: input.referenceKey ? inferEditIntent(input.extraDescription, input.editIntent) : input.editIntent };
  const config = getRuntimeConfig();
  if (!config) return Response.json({ code: "MODEL_NOT_CONFIGURED", message: "模型服务尚未配置：本次没有调用万相，也没有生成图片。请先在服务端配置新的百炼 API Key。" }, { status: 503 });

  const pipelineStartedAt = Date.now();
  const deadline = pipelineStartedAt + TOTAL_GENERATION_MS;
  const bindings = env as unknown as Bindings;
  const batchId = input.jobId && JOB_ID_PATTERN.test(input.jobId) ? input.jobId : crypto.randomUUID();
  const pipeline: PipelineImage[] = [];
  let hasSafeDraft = false;

  try {
    let referenceDataUrl: string | undefined;
    let previousContext: string | undefined;
    if (input.referenceKey) {
      if (!/^generated\/[a-zA-Z0-9/_-]+\.png$/.test(input.referenceKey)) return Response.json({ message: "只能引用作品中心里的一张历史图片。" }, { status: 400 });
      const loaded = await runTimedStage(
        stageOptions(bindings.ARTWORKS, batchId, deadline, "loading-reference", "正在读取上一张作品", 10_000, 150_000, 0),
        async () => {
          const reference = await bindings.ARTWORKS?.get(input.referenceKey!);
          if (!reference) return null;
          let context = decodeGenerationContext(reference.customMetadata?.generationContext);
          if (!context && reference.customMetadata?.contextKey) {
            const contextObject = await bindings.ARTWORKS?.get(reference.customMetadata.contextKey);
            if (contextObject) {
              try { context = decodeGenerationContext((JSON.parse(Buffer.from(await contextObject.arrayBuffer()).toString("utf8")) as { generationContext?: string }).generationContext); }
              catch { context = undefined; }
            }
          }
          return { dataUrl: `data:${reference.httpMetadata?.contentType || "image/png"};base64,${Buffer.from(await reference.arrayBuffer()).toString("base64")}`, context };
        },
      );
      if (!loaded) return Response.json({ message: "没有找到这张历史图片，请重新选择。" }, { status: 404 });
      referenceDataUrl = loaded.dataUrl;
      previousContext = loaded.context;
    }

    const queryContext = buildQueryContext(input);
    const understandingStartedAt = Date.now();
    const rewrite = await runTimedStage(
      stageOptions(bindings.ARTWORKS, batchId, deadline, "understanding", "正在理解故事和角色设定", 30_000, 110_000),
      signal => rewriteQueryWithContext(config, queryContext, { referenceDataUrl, previousContext, editIntent: input.editIntent, signal }),
    );
    const understandingMs = Date.now() - understandingStartedAt;
    const generationPrompt = buildGenerationPrompt(input, buildVisualDescription(rewrite.visualSpec, rewrite.rewrittenPrompt));
    const expectedSubjectKind = inferCharacterKind(input);
    const evaluationOptions = {
      compositionMode: input.compositionMode || "with-character" as const,
      expectedSubject: input.character.type || input.character.description || rewrite.visualSpec?.subject || "原创卡通主角",
      expectedSubjectKind,
      allowedEntities: [...(rewrite.visualSpec?.props || []), input.scene.extra && input.scene.extra !== "不添加" ? input.scene.extra : ""].filter(Boolean),
    };

    const draftStartedAt = Date.now();
    const drafts = await runTimedStage(
      stageOptions(bindings.ARTWORKS, batchId, deadline, "drafting", "正在绘制两张初稿", 60_000, 55_000),
      signal => callWan(config, generationPrompt, referenceDataUrl, 2, signal),
    );
    const draftMs = Date.now() - draftStartedAt;
    const draftEvaluation = await runTimedStage(
      stageOptions(bindings.ARTWORKS, batchId, deadline, "reviewing-drafts", "正在检查初稿的角色、画面和安全性", 22_000, 35_000),
      signal => evaluateCandidates(config, generationPrompt, drafts, evaluationOptions, signal) as Promise<Evaluation>,
    );
    drafts.forEach((url, index) => pipeline.push({ url, key: `generated/${batchId}-r1-${index + 1}.png`, stage: "draft", round: 1, stageLabel: "两张初稿竞争", durationMs: draftMs, score: scoreAt(draftEvaluation, index), evaluationReason: draftEvaluation.reason }));

    if (draftEvaluation.selectedIndex < 0) {
      await updateJob(bindings.ARTWORKS, batchId, "failed", "两张初稿均未通过质量与安全检查", { code: "ALL_CANDIDATES_REJECTED" });
      return Response.json({ code: "ALL_CANDIDATES_REJECTED", message: `2张初稿都没有达到儿童安全与质量阈值。评审原因：${draftEvaluation.reason}`, batchId, evaluation: draftEvaluation }, { status: 422 });
    }

    hasSafeDraft = true;
    const selectedDraft = pipeline[draftEvaluation.selectedIndex];
    let finalImage = selectedDraft;
    let finalEvaluation = draftEvaluation;
    let refinementComparison: Evaluation | undefined;
    let rescueTriggered = false;
    let refinementCompleted = false;

    if (remainingGenerationMs(deadline) >= 42_000) {
      try {
        const refinementStartedAt = Date.now();
        const refinedUrl = (await runTimedStage(
          stageOptions(bindings.ARTWORKS, batchId, deadline, "refining", "初稿已通过，正在定向精修", 35_000, 18_000),
          signal => callWan(config, buildRefinementPrompt(generationPrompt, draftEvaluation.reason), selectedDraft.url, 1, signal),
        ))[0];
        const refinementMs = Date.now() - refinementStartedAt;
        refinementComparison = await runTimedStage(
          stageOptions(bindings.ARTWORKS, batchId, deadline, "reviewing-refinement", "正在比较初稿与精修稿", 18_000, 10_000),
          signal => evaluateCandidates(config, generationPrompt, [selectedDraft.url, refinedUrl], evaluationOptions, signal) as Promise<Evaluation>,
        );
        const refined: PipelineImage = { url: refinedUrl, key: `generated/${batchId}-r2-1.png`, stage: "refinement", round: 2, stageLabel: "定向精修", durationMs: refinementMs, score: scoreAt(refinementComparison, 1), evaluationReason: refinementComparison.reason };
        pipeline.push(refined);
        if (refinementComparison.selectedIndex === 1) finalImage = refined;
        finalEvaluation = refinementComparison;
        refinementCompleted = true;
      } catch (error) {
        if (!isTimeoutLikeError(error)) throw error;
        await updateJob(bindings.ARTWORKS, batchId, "saving", "精修超时，正在交付已通过检查的初稿");
      }
    }

    const selectedScore = scoreAt(finalEvaluation, Math.max(0, finalEvaluation.selectedIndex));
    if (refinementCompleted && qualityNeedsRescue(selectedScore) && remainingGenerationMs(deadline) >= 45_000) {
      try {
        rescueTriggered = true;
        const rescueStartedAt = Date.now();
        const rescueUrl = (await runTimedStage(
          stageOptions(bindings.ARTWORKS, batchId, deadline, "rescuing", "正在做最后一次画面补强", 30_000, 15_000),
          signal => callWan(config, buildRefinementPrompt(generationPrompt, finalEvaluation.reason, true), finalImage.url, 1, signal),
        ))[0];
        const rescueMs = Date.now() - rescueStartedAt;
        const rescueEvaluation = await runTimedStage(
          stageOptions(bindings.ARTWORKS, batchId, deadline, "reviewing-rescue", "正在确认最终版本", 15_000, 8_000),
          signal => evaluateCandidates(config, generationPrompt, [finalImage.url, rescueUrl], evaluationOptions, signal) as Promise<Evaluation>,
        );
        const rescue: PipelineImage = { url: rescueUrl, key: `generated/${batchId}-r3-1.png`, stage: "rescue", round: 3, stageLabel: "按需最终补救", durationMs: rescueMs, score: scoreAt(rescueEvaluation, 1), evaluationReason: rescueEvaluation.reason };
        pipeline.push(rescue);
        if (rescueEvaluation.selectedIndex === 1) finalImage = rescue;
        finalEvaluation = rescueEvaluation;
      } catch (error) {
        if (!isTimeoutLikeError(error)) throw error;
      }
    }

    const totalMs = Date.now() - pipelineStartedAt;
    let saved = false;
    if (bindings.ARTWORKS && remainingGenerationMs(deadline) > 2_000) {
      try {
        await updateJob(bindings.ARTWORKS, batchId, "saving", "画面已选好，正在保存作品");
        await runTimedStage({ stage: "saving", deadline, attemptTimeoutMs: 15_000, retries: 0 }, async signal => {
          const contextKey = `contexts/${batchId}.json`;
          const contextDocument = JSON.stringify({
            version: 2, batchId, generationContext: encodeGenerationContext({ ...input, extraDescription: rewrite.rewrittenPrompt }), input,
            rewrite: { changedFields: rewrite.changedFields, lockedFields: rewrite.lockedFields, visualSpec: rewrite.visualSpec },
            pipeline: { understandingMs, totalMs, rescueTriggered, refinementCompleted, stages: pipeline.map(item => ({ key: item.key, stage: item.stage, round: item.round, stageLabel: item.stageLabel, durationMs: item.durationMs, score: item.score, finalSelected: item.key === finalImage.key })) },
            evaluations: { draft: draftEvaluation, refinement: refinementComparison, final: finalEvaluation }, createdAt: new Date().toISOString(),
          });
          const contextBytes = new TextEncoder().encode(contextDocument);
          await bindings.ARTWORKS!.put(contextKey, contextBytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "application/json" } });
          await Promise.all(pipeline.map(async item => {
            const image = await fetchImage(item.url, signal);
            const isFinal = item.key === finalImage.key;
            await bindings.ARTWORKS!.put(item.key, image.bytes, { httpMetadata: { contentType: image.contentType }, customMetadata: { batchId, stage: item.stage, round: String(item.round), stageLabel: item.stageLabel, selected: String(item === selectedDraft || item.stage !== "draft"), finalSelected: String(isFinal), reviewStatus: isFinal ? "approved" : "intermediate", contextKey, evaluator: config.visionModel, durationMs: String(item.durationMs), totalMs: String(totalMs), reason: item.evaluationReason.slice(0, 180), scores: item.score ? JSON.stringify(item.score).slice(0, 300) : "" } });
          }));
        });
        saved = true;
      } catch { saved = false; }
    }

    const imageUrl = saved ? `/api/images/${finalImage.key.slice("generated/".length)}` : finalImage.url;
    await updateJob(bindings.ARTWORKS, batchId, "completed", saved ? "漫画生成完成" : "漫画已生成，保存超时，本次使用临时图片", { imageUrl, referenceKey: saved ? finalImage.key : null });
    return Response.json({ mode: saved ? "live" : "live-temporary", imageUrl, referenceKey: saved ? finalImage.key : null, batchId, evaluation: finalEvaluation, optimizationRounds: rescueTriggered ? 4 : refinementCompleted ? 3 : 2, degraded: !refinementCompleted || !saved });
  } catch (cause) {
    const timedOut = isTimeoutLikeError(cause) || cause instanceof GenerationTimeoutError || remainingGenerationMs(deadline) === 0;
    const code = timedOut ? "GENERATION_TIMEOUT" : "GENERATION_FAILED";
    const previousJob = await readJob(bindings.ARTWORKS, batchId);
    const failedStageLabel = previousJob?.label?.replace(/，上次超时，正在自动重试$/, "") || "生成任务";
    const message = timedOut ? `“${failedStageLabel}”连续超时，任务已经停止。请点击重新生成。` : cause instanceof Error ? cause.message : "生成服务刚刚走神了，本次不会保存，请再试一次。";
    const failureDetails = { code, canRetry: true, hadSafeDraft: hasSafeDraft, lastStage: previousJob?.stage, lastStageLabel: failedStageLabel, lastAttempt: previousJob?.attempt, elapsedMs: Date.now() - pipelineStartedAt };
    await updateJob(bindings.ARTWORKS, batchId, "failed", message, failureDetails);
    return Response.json({ message, batchId, ...failureDetails }, { status: timedOut ? 504 : 502 });
  }
}
