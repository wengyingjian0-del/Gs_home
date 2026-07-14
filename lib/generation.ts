import { Buffer } from "node:buffer";

export type GenerateInput = {
  character: Record<string, string>;
  scene: Record<string, string>;
  extraDescription?: string;
  conversationContext?: string;
  referenceKey?: string;
  editIntent?: "emotion" | "action" | "background" | "extra";
};

type CandidateEvaluation = {
  selectedIndex: number;
  safe: boolean;
  reason: string;
  scores: Array<{ index: number; intent: number; character: number; quality: number; safety: number }>;
};

export type QueryRewrite = {
  rewrittenPrompt: string;
  changedFields: string[];
  lockedFields: string[];
  safe: boolean;
  riskType: string | null;
  reason: string;
};

type RuntimeConfig = {
  apiKey: string;
  workspaceId?: string;
  visionModel: string;
};

function getApiHost(config: RuntimeConfig) {
  return config.workspaceId ? `${config.workspaceId}.cn-beijing.maas.aliyuncs.com` : "dashscope.aliyuncs.com";
}

const BLOCKED_PATTERNS = [
  /色情|裸照|裸体|性行为|强奸/i,
  /自杀|自残|割腕|跳楼/i,
  /枪杀|砍死|肢解|血腥/i,
  /炸学校|制作炸弹|毒品/i,
];

const PII_PATTERNS = [
  /1[3-9]\d{9}/,
  /\b\d{17}[\dXx]\b/,
  /(?:住址|家庭地址|学校地址)[:：]?\s*[^，。]{5,}/,
];

export function validateChildSafeInput(input: GenerateInput) {
  const combined = [...Object.values(input.character || {}), ...Object.values(input.scene || {}), input.extraDescription || ""].join(" ");
  if (combined.length > 800) return { ok: false, message: "想法有一点长，我们一次画一个小场景吧。请把描述缩短后再试试。" };
  if (BLOCKED_PATTERNS.some(pattern => pattern.test(combined))) return { ok: false, message: "这个情节可能会让小朋友不舒服。我们可以改成躲开危险、呼叫大人，或者用智慧解决问题。" };
  if (PII_PATTERNS.some(pattern => pattern.test(combined))) return { ok: false, message: "为了保护你的隐私，请不要写手机号、身份证号、家庭或学校地址。去掉这些信息后再试试吧。" };
  return { ok: true };
}

export function getRuntimeConfig(): RuntimeConfig | null {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  const visionModel = process.env.BAILIAN_VISION_MODEL?.trim() || "qwen3-vl-plus";
  if (!apiKey) return null;
  return { apiKey, workspaceId, visionModel };
}

export function buildQueryContext(input: GenerateInput) {
  const c = input.character;
  const s = input.scene;
  const editLabels = { emotion: "人物表情", action: "人物动作", background: "故事背景", extra: "指定的局部细节" } as const;
  return [
    "创作一张儿童友好、积极安全的单幅漫画场景图。用户年龄不限制画面中虚构角色的年龄或类型。",
    `主角：${c.type || "儿童漫画角色"}，${c.hair || "自然发型"}，固定穿${c.outfit || "明亮服装"}，性格${c.personality || "友善"}。`,
    `画风：${c.style || "清新儿童漫画"}。保持角色脸部、发型、服装、主色和画风稳定。`,
    `场景：在${s.place || "明亮、安全的户外"}，正在${s.action || "快乐探索"}，心情${s.emotion || "开心"}。`,
    s.extra && s.extra !== "不添加" ? `画面元素：${s.extra}。` : "",
    input.extraDescription ? `补充想法：${input.extraDescription}。` : "",
    input.referenceKey && input.editIntent ? `这是基于上一张正式作品的局部修改。只修改${editLabels[input.editIntent]}；人物身份、脸、发型、服装、主色、画风以及其他未指定内容必须保持不变。` : "",
  ].filter(Boolean).join("\n");
}

function pickCharacterFields(input: GenerateInput) {
  const c = input.character;
  const allowedStyles = ["温暖绘本", "清新儿童漫画", "Q版可爱卡通", "奇幻冒险手绘"];
  const styleAliases: Record<string, string> = { "清新国漫": "清新儿童漫画", "可爱绘本": "温暖绘本", "活力动画": "Q版可爱卡通", "梦幻水彩": "奇幻冒险手绘" };
  const requestedStyle = styleAliases[c.style] || c.style;
  const outfitColor = c.primaryColor || c.outfit?.match(/橙色|蓝色|绿色|紫色|红色|黄色|粉色|白色|黑色/)?.[0] || "与人物卡参考图一致的主色";
  return {
    faceShape: c.faceShape || "与人物卡参考图一致的圆润儿童脸型",
    skinTone: c.skinTone || "健康自然肤色",
    eyes: c.eyes || "明亮圆润的卡通眼睛",
    facialMark: c.facialMark || "与人物卡参考图一致，无则不添加",
    hairColor: c.hairColor || "与人物卡参考图一致的自然发色",
    hairStyle: c.hair || "与人物卡参考图一致的固定发型",
    hairAccessory: c.hairAccessory || "与人物卡参考图一致，无则不添加",
    style: allowedStyles.includes(requestedStyle) ? requestedStyle : "清新儿童漫画",
    outfitType: c.outfitType || c.outfit || "日常儿童服装",
    outfitColor,
    accessory: c.accessory || "与人物卡参考图一致，无则不添加",
  };
}

function buildTaskBranch(input: GenerateInput, rewrittenQuery: string) {
  const s = input.scene;
  const prop = s.extra && s.extra !== "不添加" ? s.extra : "无道具";
  const weather = s.weather || "无";
  if (!input.referenceKey) {
    return `本次全新场景生成需求，仅修改场景、动作、表情、道具，角色锁定特征完全保留
故事地点：${s.place || "明亮、安全的儿童场景"}
人物动作：${s.action || "自然站立并温和探索"}
人物情绪：${s.emotion || "开心"}
可选道具：${prop}
天气&时间：${weather}
儿童补充文字/语音描述：${rewrittenQuery || "无"}
执行要求：完整还原全部场景要素；只改动动作、表情、背景、道具；严格保留上方全部角色锁定外貌、发型、画风、默认服装，不改动角色核心识别特征。`;
  }

  if (input.editIntent === "emotion" || input.editIntent === "extra") {
    const change = input.editIntent === "emotion" ? `人物表情调整为${s.emotion || "开心"}` : `道具调整为${prop}；补充要求为${rewrittenQuery || "无"}`;
    return `本次仅局部微调，严格区分保持项与修改项，禁止重构整张画面
需要单独修改内容：${change}
必须完整保留全部固定内容：角色脸型、发型、发色、画风、原有全套服装、基础肢体动作、原始背景整体构图；
仅调整指定局部元素，画面其余内容尽量维持原样，不重绘整体布局、不更换角色长相、不改变主场景。`;
  }

  return `本次为重绘全新创作分支，仅保留角色核心识别特征，允许整体重排画面
角色永久锁定项全部不变：脸型、发型、发色、固定画风、基础人物人设；
允许整体更换内容：全身大幅度动作、完整背景环境、整套服装、画面构图视角；
本次创作要求：${rewrittenQuery || "按当前场景选项重新创作"}
故事地点：${s.place || "保持当前地点"}；人物动作：${s.action || "保持当前动作"}；人物情绪：${s.emotion || "开心"}；道具：${prop}；天气&时间：${weather}
硬性约束：保证角色高度辨识度，长相、发型、画风与原始人物卡完全统一，不能出现角色变样。`;
}

export function buildGenerationPrompt(input: GenerateInput, rewrittenQuery: string) {
  const c = pickCharacterFields(input);
  const taskBranch = buildTaskBranch(input, rewrittenQuery);
  return `你是创作儿童友好、适龄治愈漫画的AI绘画模型。使用者年龄仅是产品权限规则，不限制画面中虚构角色的年龄或类型；允许婴儿、幼儿、儿童、动物、机器人等安全的虚构卡通角色。所有生成图片必须严格遵守以下全部硬性规则，规则优先级高于画面美观度，违反任意一条直接作废：
一、画风与视觉基础规范
1. 固定输出竖版3:4比例漫画构图，画面主体角色居中突出，背景简洁干净，不抢夺人物视觉重心；
2. 可选统一画风：温暖绘本、清新儿童漫画、Q版可爱卡通、奇幻冒险手绘；禁止写实真人、暗黑恐怖、惊悚哥特、重金属、赛博朋克、成人厚涂、血腥写实画风；
3. 线条全部圆润柔和，无尖锐棱角、破碎裂痕、扭曲惊悚轮廓；整体低饱和柔和马卡龙配色，光影明亮温暖，无大面积阴暗、压抑、黑雾、诡异阴影；
4. 杜绝画面崩坏：不出现五官错位、多手多脚、肢体断裂、五官糊脸、畸形四肢、扭曲人体、模糊重影；
5. 画面内禁止出现任何文字、手写涂鸦、水印、logo、广告标语、乱码符号、数字、隐私信息。

二、内容安全零容忍红线，绝对禁止绘制
1. 危险伤害类：打架斗殴、自残、刀具、火源、深水溺水、高空攀爬、触电、玻璃碎片、伤口、血迹、骷髅、鬼怪、幽灵、恐怖怪物；
2. 不良成人导向：烟酒、毒品、性感暴露服饰、暧昧亲密肢体接触、早恋恋爱画面、成人妆容；
3. 隐私与真人风险：真实人脸、真人肖像、学校名称、家庭住址、手机号、姓名、身份证、精确地理位置；
4. 负面容貌焦虑：身材评判、丑化五官、对比丑美、夸张缺陷；所有角色五官端正、阳光正向；
5. 歧视与霸凌：校园欺凌、嘲笑、孤立、讽刺、对立冲突角色。

三、角色与生成底层逻辑
1. 单图仅存在1位核心主角，不得自动新增无关次要人物、路人、大量配角；
2. 仅支持单张内部参考图作为角色基准（人物卡/历史生成作品），禁止融合多张参考图特征；
3. 严格区分【永久保持项】【默认保持项】【允许修改项】，未标注修改的元素必须完整保留；
4. 儿童描述模糊、情节存在风险时，自动替换为安全、正向、低龄友好的替代情节；危险行为替换为智慧解决、温和互动、躲避、魔法辅助等正向方案。

四、适龄情绪氛围要求
全程画面氛围积极向上，仅允许开心、好奇、勇敢、温柔、平静、自豪、惊喜等正向情绪；不生成悲伤、绝望、恐惧、愤怒、阴郁压抑画面。

【最高优先级强制角色锁定规则，优先级高于场景、动作、背景、道具，所有画面必须严格遵守，跨场景不能改变角色识别特征】
本次固定主角完整人设，所有永久锁定元素全程不可变更：
1. 面部永久锁定：脸型${c.faceShape}、肤色${c.skinTone}、眼睛样式${c.eyes}、标志性五官特征${c.facialMark}；五官比例、长相、面部轮廓完全统一，任何场景不换脸；
2. 发型永久锁定：发色${c.hairColor}、发型样式${c.hairStyle}、发型专属装饰${c.hairAccessory}；发型长度、轮廓、颜色全程不变；
3. 画风永久锁定：固定漫画风格${c.style}；线条质感、上色笔触、色彩统一标准全程固定，不得切换画风；
4. 服装默认锁定（无明确换装指令时强制不变）：服装类型${c.outfitType}、服装主色调${c.outfitColor}、固定专属配饰${c.accessory}；仅用户明确要求换装时才可更换整套服装；

仅允许自由调整的内容（除此以外全部保持原样）：人物面部表情、全身肢体动作、所处场景地点、天气时间、小型手持道具、背景环境；
一致性硬性要求：无论更换任何场景、动作、情绪、背景，观众第一眼可识别为同一个角色；严禁脸型突变、发色改变、发型更换、画风切换、五官大变。

【本次生成任务类型指令，严格按对应要求执行】
${taskBranch}`;
}

export async function rewriteQueryWithContext(
  config: RuntimeConfig,
  basePrompt: string,
  options: { referenceDataUrl?: string; previousContext?: string; editIntent?: GenerateInput["editIntent"] },
) {
  const instruction = [
    "你是儿童漫画生图请求改写器，不负责生成图片。",
    "请结合当前请求、上一张正式作品及其结构化上下文，把儿童的简短表达改写为清楚、无歧义的中文生图指令。",
    "不得添加用户没有提出的新人物、新剧情、品牌、文字或危险元素。",
    "如果是局部修改，只改指定字段；角色身份、脸、发型、服装、主色、画风、构图和其他未指定内容应列入lockedFields。",
    "如果没有历史图，仍需保持角色卡中的固定特征。",
    `指定修改类型：${options.editIntent || "新场景"}`,
    `上一轮结构化上下文：${options.previousContext || "无"}`,
    `当前基础指令：\n${basePrompt}`,
    "同时只判断儿童实际提出或选择的情节是否安全。固定安全规则中的禁用词不得作为违规证据；例如‘禁止血腥’本身是安全要求，不能判为风险。",
    "只输出JSON：{\"rewrittenPrompt\":\"仅包含本轮实际创作意图的完整生图指令\",\"changedFields\":[\"字段\"],\"lockedFields\":[\"字段\"],\"safe\":true,\"riskType\":null,\"reason\":\"安全或风险判断原因\"}",
  ].join("\n");
  const content: Array<Record<string, unknown>> = [];
  if (options.referenceDataUrl) content.push({ type: "image_url", image_url: { url: options.referenceDataUrl } });
  content.push({ type: "text", text: instruction });
  const endpoint = `https://${getApiHost(config)}/compatible-mode/v1/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.visionModel, messages: [{ role: "user", content }], temperature: 0, response_format: { type: "json_object" } }),
  });
  if (!response.ok) throw new Error(`上下文理解服务暂时不可用（${response.status}）`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const rewrite = extractJson<QueryRewrite>(data.choices?.[0]?.message?.content || "");
  if (!rewrite.rewrittenPrompt || rewrite.rewrittenPrompt.length > 4000 || !Array.isArray(rewrite.changedFields) || !Array.isArray(rewrite.lockedFields) || typeof rewrite.safe !== "boolean") {
    throw new Error("这次没有理解清楚要改什么，请换一种简单说法再试试。");
  }
  if (!rewrite.safe) throw new Error(rewrite.reason || "这个情节可能不适合儿童，我们换一个安全、温和的想法吧。");
  const rewrittenPrivacy = validateRewrittenPrivacy(rewrite.rewrittenPrompt);
  if (!rewrittenPrivacy.ok) throw new Error("改写内容中仍有个人信息，请去掉手机号、身份证号或具体地址后再试试。");
  return rewrite;
}

export async function callWan(config: RuntimeConfig, prompt: string, referenceDataUrl?: string) {
  const content: Array<{ text?: string; image?: string }> = [];
  if (referenceDataUrl) content.push({ image: referenceDataUrl });
  content.push({ text: prompt });
  const endpoint = `https://${getApiHost(config)}/api/v1/services/aigc/multimodal-generation/generation`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "wan2.7-image", input: { messages: [{ role: "user", content }] }, parameters: { size: "1536*2048", n: 4, watermark: false } }),
  });
  if (!response.ok) throw new Error(`万相生成服务暂时不可用（${response.status}）`);
  const data = await response.json() as { output?: { choices?: Array<{ message?: { content?: Array<{ type?: string; image?: string }> } }> } };
  const urls = data.output?.choices?.flatMap(choice => choice.message?.content || []).filter(item => item.type === "image" && item.image).map(item => item.image as string) || [];
  if (urls.length < 4) throw new Error("候选图片没有完整生成，本次不会计入正式作品");
  return urls.slice(0, 4);
}

function extractJson<T>(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(source) as T;
}

function validateRewrittenPrivacy(text: string) {
  if (PII_PATTERNS.some(pattern => pattern.test(text))) return { ok: false };
  return { ok: true };
}

export function encodeGenerationContext(input: GenerateInput) {
  const compact = { character: input.character, scene: input.scene, extraDescription: (input.extraDescription || "").slice(0, 120), conversationContext: (input.conversationContext || "").slice(-1000) };
  return Buffer.from(JSON.stringify(compact), "utf8").toString("base64url");
}

export function decodeGenerationContext(encoded?: string) {
  if (!encoded) return undefined;
  try {
    const value = Buffer.from(encoded, "base64url").toString("utf8");
    return value.length <= 1600 ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function evaluateCandidates(config: RuntimeConfig, prompt: string, urls: string[]) {
  const endpoint = `https://${getApiHost(config)}/compatible-mode/v1/chat/completions`;
  const evaluationPrompt = `你是儿童漫画候选图安全与质量评审器。用户创作目标如下：\n${prompt}\n\n依次检查4张候选图。出现色情、裸露、血腥伤害、恐怖惊吓、危险模仿、个人信息、真实儿童照片感时，该图safety必须为0。综合意图符合度、角色特征一致性、画面质量和儿童安全选出唯一最佳图。只输出JSON，不要解释：{"selectedIndex":0,"safe":true,"reason":"简短原因","scores":[{"index":0,"intent":0,"character":0,"quality":0,"safety":0}]}。每项分数0到100；若没有安全候选，safe=false。`;
  const clarification = "重要判定说明：虚构的婴儿、幼儿或儿童卡通角色本身是允许的；名字、圆脸、胖、蘑菇头等虚构角色设定不是个人信息或安全风险。只有画面呈现真实照片、逼真真人肖像或可识别真实儿童时，才按真实儿童照片感降为0。请逐张独立评分，不得因其中一张失败而否定其他安全候选。";
  const content: Array<Record<string, unknown>> = [{ type: "text", text: `${evaluationPrompt}\n${clarification}` }];
  urls.forEach((url, index) => {
    content.push({ type: "text", text: `候选图 ${index}` });
    content.push({ type: "image_url", image_url: { url } });
  });
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: config.visionModel, messages: [{ role: "user", content }], temperature: 0, response_format: { type: "json_object" } }) });
  if (!response.ok) throw new Error(`视觉评审服务暂时不可用（${response.status}）`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const evaluation = extractJson<CandidateEvaluation>(data.choices?.[0]?.message?.content || "");
  const safeScores = (evaluation.scores || []).filter(score => Number.isInteger(score.index) && score.index >= 0 && score.index < urls.length && score.safety >= 80);
  if (!safeScores.length) return { ...evaluation, selectedIndex: -1, safe: false, reason: evaluation.reason || "4张候选图的儿童安全评分都低于80分" };
  const requested = safeScores.find(score => score.index === Number(evaluation.selectedIndex));
  const best = requested || [...safeScores].sort((a, b) => (b.intent + b.character + b.quality + b.safety) - (a.intent + a.character + a.quality + a.safety))[0];
  return { ...evaluation, selectedIndex: best.index, safe: true, reason: requested ? evaluation.reason : `原入选图未通过安全阈值，已自动改选安全候选图 ${best.index + 1}` };
}

export async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("历史图片读取失败");
  const mime = response.headers.get("content-type") || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
