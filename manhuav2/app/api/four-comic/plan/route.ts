import { env } from "@/lib/runtime-env";
import { validateChildSafeInput } from "@/lib/generation";

type Panel = { title: string; scene: string; action: string; emotion: string; background: string; dialogue: string; narration: string };

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(source) as { storyTitle: string; panels: Panel[] };
}

export async function POST(request: Request) {
  const input = await request.json() as { character?: Record<string, string>; genre?: string; idea?: string };
  if (!input.character || !input.genre) return Response.json({ message: "请先选择角色和故事类型。" }, { status: 400 });
  const validation = validateChildSafeInput({ character: input.character, scene: { place: "四格漫画", action: "创作连贯故事" }, extraDescription: input.idea || "", compositionMode: "with-character" });
  if (!validation.ok) return Response.json({ code: validation.code, message: validation.message }, { status: 422 });
  const runtime = env as unknown as Record<string, string | undefined>;
  const apiKey = runtime.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY;
  const workspaceId = runtime.DASHSCOPE_WORKSPACE_ID || process.env.DASHSCOPE_WORKSPACE_ID;
  const model = runtime.BAILIAN_VISION_MODEL || process.env.BAILIAN_VISION_MODEL || "qwen3-vl-plus";
  if (!apiKey) return Response.json({ message: "故事策划模型尚未配置。" }, { status: 503 });

  const host = workspaceId ? `${workspaceId}.cn-beijing.maas.aliyuncs.com` : "dashscope.aliyuncs.com";
  const prompt = `你是儿童友好四格漫画编剧。使用者年龄不限制故事中虚构角色的年龄或类型。请基于固定主角和用户灵感，创作一个安全、连贯、有起因发展转折结局的四格故事。
固定角色：${JSON.stringify(input.character)}
故事类型：${input.genre}
用户灵感：${(input.idea || "请自动构思").slice(0, 2000)}
规则：四格必须是同一个角色，发型、服装、配饰、画风始终不变；每格说明场景、动作、表情、背景；台词简短自然，每格最多28个汉字；不得出现危险、恐怖、隐私或成人内容；结局积极或轻松反转。只输出JSON：{"storyTitle":"标题","panels":[{"title":"第1格作用","scene":"地点时间","action":"动作","emotion":"表情","background":"背景细节","dialogue":"角色台词，无则空字符串","narration":"旁白，无则空字符串"}]}`;
  try {
    const response = await fetch(`https://${host}/compatible-mode/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.45, max_tokens: 1200, response_format: { type: "json_object" } }) });
    if (!response.ok) throw new Error(`故事模型暂时不可用（${response.status}）`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const plan = extractJson(data.choices?.[0]?.message?.content || "");
    if (!plan.storyTitle || !Array.isArray(plan.panels) || plan.panels.length !== 4) throw new Error("故事分镜没有完整生成");
    return Response.json({ storyTitle: plan.storyTitle.slice(0, 30), panels: plan.panels.map(panel => ({ ...panel, dialogue: String(panel.dialogue || "").slice(0, 60), narration: String(panel.narration || "").slice(0, 60) })) });
  } catch (cause) {
    return Response.json({ message: cause instanceof Error ? cause.message : "故事策划失败，请再试一次。" }, { status: 502 });
  }
}
