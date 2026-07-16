import { Buffer } from "node:buffer";

export type GenerateInput = {
  jobId?: string;
  character: Record<string, string>;
  scene: Record<string, string>;
  compositionMode?: "with-character" | "scene-only";
  allowIncomplete?: boolean;
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
  visualSpec?: VisualSpec;
  changedFields: string[];
  lockedFields: string[];
  safe: boolean;
  riskType: string | null;
  reason: string;
};

export type CandidateEvaluationOptions = {
  compositionMode?: "with-character" | "scene-only";
  expectedSubject?: string;
  expectedSubjectKind?: CharacterKind;
  allowedEntities?: string[];
};

export type CharacterKind = "human" | "robot" | "animal" | "fantasy" | "neutral";

export type VisualSpec = {
  subject?: string;
  appearance?: string;
  clothing?: string;
  scene?: string;
  action?: string;
  mood?: string;
  props?: string[];
  lighting?: string;
  style?: string;
  composition?: string;
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
  /拿着?刀|持刀|刀.{0,8}(?:追|打|砍|刺)|追打(?:同学|小朋友|儿童)|殴打|攻击同学|欺负同学/i,
];

const REAL_PERSON_PATTERNS = [
  /真实(?:明星|演员|歌手|网红|名人|人物)/i,
  /真人(?:明星|肖像|照片|长相)/i,
  /(?:照着|模仿|画成|变成).{0,12}(?:明星|演员|歌手|网红|名人)/i,
];

const JAILBREAK_PATTERNS = [
  /忽略.{0,12}(?:规则|限制|安全|系统|指令)/i,
  /绕过.{0,12}(?:规则|限制|审核|安全)/i,
  /越狱|jailbreak|无视系统提示|解除限制|开发者模式/i,
];

const PII_PATTERNS = [
  /1[3-9]\d{9}/,
  /\b\d{17}[\dXx]\b/,
  /(?:住址|家庭地址|学校地址)[:：]?\s*[^，。]{5,}/,
];

export function validateChildSafeInput(input: GenerateInput) {
  const combined = [...Object.values(input.character || {}), ...Object.values(input.scene || {}), input.extraDescription || ""].join(" ");
  if (combined.length > 2500) return { ok: false, code: "INPUT_TOO_LONG", message: "内容超过了单次创作上限。请保留主要角色、场景和关键情节，控制在 2000 字以内。" };
  if (JAILBREAK_PATTERNS.some(pattern => pattern.test(combined))) return { ok: false, code: "POLICY_BYPASS_REJECTED", message: "不能绕过儿童安全和隐私规则。请直接描述一个安全、虚构的漫画情节。" };
  if (REAL_PERSON_PATTERNS.some(pattern => pattern.test(combined))) return { ok: false, code: "REAL_PERSON_REJECTED", message: "不能照搬真实明星或真人的身份和长相。可以改成不对应任何真人的原创虚构角色。" };
  if (BLOCKED_PATTERNS.some(pattern => pattern.test(combined))) return { ok: false, code: "UNSAFE_CONTENT_REJECTED", message: "这个请求包含危险或伤害行为，已停止生成。可以改成远离危险、向大人求助，或者用智慧和平解决问题。" };
  if (PII_PATTERNS.some(pattern => pattern.test(combined))) return { ok: false, code: "PRIVATE_INFO_REJECTED", message: "为了保护你的隐私，请不要写手机号、身份证号、家庭或学校地址。去掉这些信息后再试试吧。" };
  if (!input.referenceKey && !input.allowIncomplete) {
    const text = combined.replace(/不添加|无/g, "");
    const c = input.character || {};
    const s = input.scene || {};
    const characterKind = inferCharacterKind(input);
    const missingFields: string[] = [];
    if (input.compositionMode !== "scene-only") {
      if (!c.type?.trim() && !/(?:男孩|女孩|儿童|少年|少女|宝宝|人物|动物|猫|狗|兔|机器人|精灵)/i.test(text)) missingFields.push("主角是谁");
      if (characterKind === "human") {
        if (!c.hair?.trim() && !/(?:头发|发型|短发|长发|卷发|直发|辫|马尾|刘海|光头|帽子)/i.test(text)) missingFields.push("外貌或发型");
        if (!c.outfit?.trim() && !/(?:穿|衣服|服装|裙|裤|卫衣|外套|衬衫|校服|礼服|颜色)/i.test(text)) missingFields.push("服装特点");
      } else if (characterKind === "robot" && !/(?:金属|陶瓷|机械|外壳|屏幕|传感器|圆头|方头|关节|按钮|轮子|履带|颜色)/i.test(text.replace(/机器人|机器伙伴/g, ""))) {
        missingFields.push("机器人的头部、外壳或材质特点");
      } else if (characterKind === "animal" && !/(?:毛|羽毛|鳞片|耳朵|尾巴|花纹|颜色|体型|翅膀|口鼻)/i.test(text)) {
        missingFields.push("动物的物种外观或颜色特点");
      } else if (characterKind === "fantasy" && !/(?:身体|材质|翅膀|角|尾巴|触手|颜色|形状|发光)/i.test(text)) {
        missingFields.push("主角的身体结构或材质特点");
      }
    }
    if (!s.place?.trim() && !/(?:在|森林|校园|学校|教室|海边|沙滩|城市|街道|家里|房间|公园|天空|太空|梦境|室内|室外)/i.test(text)) missingFields.push("故事地点");
    const actionMentioned = Boolean(s.action?.trim()) || /(?:正在|跑|跳|走|坐|站|看|找|拿|捡|玩|画|读|骑|搭建|探索|观察|睡|笑|挥手)/i.test(text);
    const sceneHasEnoughEnvironment = input.compositionMode === "scene-only" && Boolean(s.place?.trim() && (s.extra?.trim() || s.weather?.trim()));
    if (!actionMentioned && !sceneHasEnoughEnvironment) missingFields.push(input.compositionMode === "scene-only" ? "场景中的事件" : "主角动作");
    if (missingFields.length) {
      return {
        ok: false,
        code: "CLARIFICATION_REQUIRED",
        canContinue: true,
        missingFields,
        message: `当前描述还没有说明：${missingFields.join("、")}。你可以补充这些特点，也可以按当前描述直接生成，由 AI 使用中性默认设定。`,
      };
    }
  }
  return { ok: true };
}

export function inferEditIntent(text = "", requested?: GenerateInput["editIntent"]) {
  if (requested && requested !== "extra") return requested;
  if (/(?:背景|场景|地点|天气|雨天|晴天|白天|夜晚|黄昏|室内|室外)/i.test(text)) return "background" as const;
  if (/(?:动作|正在|跑|跳|坐|站|骑|拿|放下|挥手|转身)/i.test(text)) return "action" as const;
  if (/(?:表情|心情|开心|难过|惊喜|生气|微笑|哭|笑)/i.test(text)) return "emotion" as const;
  return requested || "extra";
}

export function getRuntimeConfig(): RuntimeConfig | null {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  const workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim();
  const visionModel = process.env.BAILIAN_VISION_MODEL?.trim() || "qwen3-vl-plus";
  if (!apiKey) return null;
  return { apiKey, workspaceId, visionModel };
}

export function inferCharacterKind(input: Pick<GenerateInput, "character" | "extraDescription">): CharacterKind {
  const c = input.character || {};
  const text = [c.type, c.description, c.material, input.extraDescription].filter(Boolean).join(" ");
  if (/(?:机器人|机器伙伴|机械人|机甲|机械生命|仿生机器人|android|robot)/i.test(text)) return "robot";
  if (/(?:动物|猫|狗|犬|兔|熊|狐狸|狼|鸟|松鼠|熊猫|老虎|狮子|龙猫|小鹿|企鹅|海豚|鲸|鱼)/i.test(text)) return "animal";
  if (/(?:精灵|外星人|怪兽|史莱姆|龙|独角兽|魔法生物|植物角色|云朵角色|幻想角色)/i.test(text)) return "fantasy";
  if (/(?:男孩|女孩|儿童|少年|少女|宝宝|人物|学生|人类|哥哥|姐姐|弟弟|妹妹)/i.test(text)) return "human";
  return "neutral";
}

function characterKindLabel(kind: CharacterKind, explicitType?: string) {
  if (explicitType?.trim()) return explicitType.trim();
  return { human: "原创卡通人物", robot: "完整的机器人主角", animal: "原创卡通动物主角", fantasy: "原创幻想生物主角", neutral: "用户描述的原创卡通主角" }[kind];
}

function buildCharacterContextDefaults(input: GenerateInput) {
  const c = input.character;
  const kind = inferCharacterKind(input);
  const label = characterKindLabel(kind, c.type);
  if (kind === "robot") return `主角类型：${label}。头部与身体保持清晰机械结构，材质为金属、陶瓷或合成外壳；${c.hair ? `头部造型：${c.hair}；` : "头部使用机械头壳、面罩或传感器结构；"}${c.outfit ? `外部装束：${c.outfit}；` : "身体使用完整机械躯干与机械关节；"}机械身份覆盖头部、躯干和四肢，不能只在手部添加机械特征。`;
  if (kind === "animal") return `主角类型：${label}。保持明确的动物头部、耳朵或口鼻、身体轮廓与毛发/羽毛/鳞片特征；${c.outfit ? `装束：${c.outfit}；` : "装束不改变动物物种身份；"}`;
  if (kind === "fantasy") return `主角类型：${label}。保持用户描述的非人类身体结构、材质和标志性器官，不自动改成人类儿童。`;
  if (kind === "human") return `主角类型：${label}，${c.hair || "自然发型"}，固定穿${c.outfit || "明亮服装"}，性格${c.personality || "友善"}。`;
  return `主角类型：${label}。只依据用户描述确定物种、身体结构和材质；信息缺失时使用中性的卡通形态，不自动补成人类儿童。`;
}

export function buildQueryContext(input: GenerateInput) {
  const c = input.character;
  const s = input.scene;
  const sceneOnly = input.compositionMode === "scene-only";
  const editLabels = { emotion: "人物表情", action: "人物动作", background: "故事背景", extra: "指定的局部细节" } as const;
  return [
    "创作一张儿童友好、积极安全的单幅漫画场景图。用户年龄不限制画面中虚构角色的年龄或类型。",
    sceneOnly ? "创作模式：纯场景，不出现主角、人物或拟人化角色。" : buildCharacterContextDefaults(input),
    !sceneOnly && c.description ? `主角补充设定：${c.description.slice(0, 240)}。这是角色卡中的固定身份信息。` : "",
    sceneOnly ? `画风：${c.style || "清新儿童漫画"}。` : `画风：${c.style || "清新儿童漫画"}。保持角色身份、物种、整体形态、材质、主色和画风稳定。`,
    sceneOnly ? `场景：${s.place || "明亮、安全的户外"}，环境事件：${s.action || "安静自然"}。` : `场景：在${s.place || "明亮、安全的户外"}，正在${s.action || "快乐探索"}，心情${s.emotion || "开心"}。`,
    s.extra && s.extra !== "不添加" ? `画面元素：${s.extra}。` : "",
    input.extraDescription ? `补充想法：${input.extraDescription}。` : "",
    input.conversationContext ? `最近多轮对话（越靠后优先级越高）：${input.conversationContext.slice(-1600)}。只覆盖发生冲突的字段，其他已经确认的要求继续保留。` : "",
    input.referenceKey && input.editIntent ? `这是基于上一张正式作品的局部修改。只修改${editLabels[input.editIntent]}；主角身份、物种、整体形态、材质、主色和画风必须保持不变。参考图中未被本轮文字明确要求的背景角色、漂浮装饰或偶发元素不得继承。` : "",
  ].filter(Boolean).join("\n");
}

function pickCharacterFields(input: GenerateInput) {
  const c = input.character;
  const kind = inferCharacterKind(input);
  const allowedStyles = ["温暖绘本", "清新儿童漫画", "Q版可爱卡通", "奇幻冒险手绘"];
  const styleAliases: Record<string, string> = { "清新国漫": "清新儿童漫画", "可爱绘本": "温暖绘本", "活力动画": "Q版可爱卡通", "梦幻水彩": "奇幻冒险手绘" };
  const requestedStyle = styleAliases[c.style] || c.style;
  const outfitColor = c.primaryColor || c.outfit?.match(/橙色|蓝色|绿色|紫色|红色|黄色|粉色|白色|黑色/)?.[0] || "与人物卡参考图一致的主色";
  return {
    kind,
    subjectLabel: characterKindLabel(kind, c.type),
    faceShape: c.faceShape || "与人物卡参考图一致的圆润卡通脸型",
    skinTone: c.skinTone || "健康自然肤色",
    eyes: c.eyes || "明亮圆润的卡通眼睛",
    facialMark: c.facialMark || "与人物卡参考图一致，无则不添加",
    hairColor: c.hairColor || "与人物卡参考图一致的自然发色",
    hairStyle: c.hair || "与人物卡参考图一致的固定发型",
    hairAccessory: c.hairAccessory || "与人物卡参考图一致，无则不添加",
    style: allowedStyles.includes(requestedStyle) ? requestedStyle : "清新绘本漫画",
    outfitType: c.outfitType || c.outfit || "日常明亮服装",
    outfitColor,
    accessory: c.accessory || "与人物卡参考图一致，无则不添加",
  };
}

function buildCharacterSubject(input: GenerateInput, fields: ReturnType<typeof pickCharacterFields>) {
  const c = input.character;
  if (fields.kind === "robot") return `画面焦点：一位完整的原创卡通机器人主角。
机器人身份硬约束：头部是机械头壳、面罩或传感器组件；躯干是机械外壳；肩、肘、腕、髋、膝和踝呈现机械关节；四肢使用金属、陶瓷或合成材质。机械结构必须覆盖全身，不能只画机械手或机械手套。
外壳与装束：${c.outfit || "完整、圆润、无尖锐边缘的机械外壳"}；主色：${fields.outfitColor}；头部造型：${c.hair || "机械头壳或传感器造型，不使用人类头发"}。
身份排除：主体不使用人类皮肤、人类耳朵、人类鼻子或人类儿童躯干；允许友好的屏幕表情、发光眼或简化机械面部。
统一画风：${fields.style}。在不同画面中保持同一机械头部、躯干结构、关节、外壳主色和绘画笔触。`;
  if (fields.kind === "animal") return `画面焦点：一位${fields.subjectLabel}。
物种身份硬约束：保持明确的动物头部、耳朵或口鼻、身体轮廓以及毛发、羽毛或鳞片材质；拟人动作和服装不能把主体改成人类儿童。
装束：${c.outfit || "简洁装束，不遮挡物种特征"}；主色：${fields.outfitColor}；统一画风：${fields.style}。`;
  if (fields.kind === "fantasy") return `画面焦点：一位${fields.subjectLabel}。
身份硬约束：保持用户描述的非人类身体结构、材质、器官和轮廓；可爱化不等于人类儿童化，不自动添加人类皮肤、发型或儿童躯干。
统一画风：${fields.style}。`;
  if (fields.kind === "neutral") return `画面焦点：${fields.subjectLabel}。
主体类型尚未指定时，只使用中性的卡通身体结构和用户明确描述的可见特征，不默认生成人类儿童，不擅自添加人类皮肤、头发或服装。
统一画风：${fields.style}。`;
  return `画面焦点：一位原创卡通人物主角。
主角脸型：${fields.faceShape}；肤色：${fields.skinTone}；眼睛：${fields.eyes}；面部特征：${fields.facialMark}。
主角发型：${fields.hairStyle}；发色：${fields.hairColor}；发饰：${fields.hairAccessory}。
主角服装：${fields.outfitType}；服装主色：${fields.outfitColor}；配饰：${fields.accessory}。
统一画风：${fields.style}。主角在不同画面中保持同一张脸、同一发型和相同绘画笔触。`;
}

function buildTaskBranch(input: GenerateInput, rewrittenQuery: string) {
  const s = input.scene;
  const prop = s.extra && s.extra !== "不添加" ? s.extra : "自然、简洁的环境细节";
  const weather = s.weather || "明亮自然光";
  if (input.compositionMode === "scene-only") {
    return `本次创作一幅纯环境场景插图。
场景地点：${s.place || "明亮、舒适的户外环境"}
环境与事件：${s.action || "安静自然"}
画面元素：${prop}
天气和时间：${weather}
本轮完整要求：${rewrittenQuery || "自然、温暖的绘本场景"}
构图内容集中在环境、建筑、植物和明确描述的普通物品。`;
  }
  if (!input.referenceKey) {
    return `本次创作一幅全新场景，角色设定保持统一。
故事地点：${s.place || "明亮、舒适的绘本场景"}
主角动作：${s.action || "自然站立并温和探索"}
主角情绪：${s.emotion || "开心"}
可选道具：${prop}
天气&时间：${weather}
补充描述：${rewrittenQuery || "温暖的日常探索"}
画面完整呈现这些场景要素，主角身份、物种、整体形态、材质、配色和画风与角色卡一致。`;
  }

  if (input.editIntent === "emotion" || input.editIntent === "extra") {
    const change = input.editIntent === "emotion" ? `主角表情调整为${s.emotion || "开心"}` : `画面细节为${prop}；补充要求为${rewrittenQuery || "保持当前画面"}`;
    return `本次以参考图为基础进行局部更新。
重点更新：${change}
角色身份、物种、整体形态、材质、主色、画风、基础动作和背景构图延续参考图；画面实体以本轮文字明确描述的内容为准。`;
  }

  return `本次以参考图中的主角外观为基础，创作一个新的完整画面。
主角保持统一：身份、物种、整体身体结构、材质、主色、固定画风和基础设定；
本轮更新范围：动作、背景环境、服装和构图视角；
本次创作要求：${rewrittenQuery || "按当前场景选项重新创作"}
故事地点：${s.place || "延续当前地点"}；主角动作：${s.action || "自然动作"}；主角情绪：${s.emotion || "开心"}；道具：${prop}；天气&时间：${weather}
角色身份、物种、整体形态、材质和画风与原始角色卡统一，背景实体按照本轮文字重新组织。`;
}

export function normalizeWanVisualLanguage(text: string) {
  return text
    .replace(/少先队员/g, "戴红色三角形颈巾的原创卡通学生角色")
    .replace(/红领巾/g, "红色三角形颈巾")
    .replace(/小黄帽/g, "明黄色圆顶帽")
    .replace(/小女孩/g, "原创卡通女孩角色")
    .replace(/小男孩/g, "原创卡通男孩角色")
    .replace(/(?:婴儿|幼儿|儿童)真人/g, "原创卡通小角色")
    .replace(/(?:耐克|Nike|阿迪达斯|Adidas)/gi, "简洁的运动风图案")
    .replace(/警察/g, "穿蓝色制服的原创卡通公共服务角色")
    .replace(/军装/g, "整洁的绿色制服")
    .replace(/护士/g, "穿浅色护理制服的原创卡通角色")
    .replace(/医生/g, "穿白色工作服的原创卡通角色");
}

function cleanVisualValue(value: unknown, maxLength = 240) {
  if (typeof value !== "string") return "";
  return normalizeWanVisualLanguage(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeVisualSpec(spec?: VisualSpec): VisualSpec | undefined {
  if (!spec || typeof spec !== "object") return undefined;
  const normalized: VisualSpec = {
    subject: cleanVisualValue(spec.subject),
    appearance: cleanVisualValue(spec.appearance),
    clothing: cleanVisualValue(spec.clothing),
    scene: cleanVisualValue(spec.scene),
    action: cleanVisualValue(spec.action),
    mood: cleanVisualValue(spec.mood, 80),
    props: Array.isArray(spec.props) ? spec.props.map(value => cleanVisualValue(value, 80)).filter(Boolean).slice(0, 8) : [],
    lighting: cleanVisualValue(spec.lighting, 120),
    style: cleanVisualValue(spec.style, 120),
    composition: cleanVisualValue(spec.composition, 160),
  };
  return Object.values(normalized).some(value => Array.isArray(value) ? value.length : Boolean(value)) ? normalized : undefined;
}

export function buildVisualDescription(spec: VisualSpec | undefined, fallback: string) {
  const normalized = normalizeVisualSpec(spec);
  if (!normalized) return normalizeWanVisualLanguage(fallback);
  return [
    normalized.subject && `主体：${normalized.subject}`,
    normalized.appearance && `外观：${normalized.appearance}`,
    normalized.clothing && `服装：${normalized.clothing}`,
    normalized.scene && `场景：${normalized.scene}`,
    normalized.action && `动作：${normalized.action}`,
    normalized.mood && `情绪：${normalized.mood}`,
    normalized.props?.length && `物品：${normalized.props.join("、")}`,
    normalized.lighting && `光线：${normalized.lighting}`,
    normalized.style && `画风：${normalized.style}`,
    normalized.composition && `构图：${normalized.composition}`,
  ].filter(Boolean).join("\n");
}

export function buildStrictWanFallback(prompt: string) {
  return normalizeWanVisualLanguage(prompt)
    .split("\n")
    .filter(line => !/(?:审核|检查|规则|政策|禁止|不得|拒绝|违规)/.test(line))
    .join("\n")
    .replace(/(?:婴儿|幼儿|儿童|未成年)/g, "原创卡通小角色")
    .replace(/(?:少先队|共青团|组织成员)/g, "原创卡通学生角色")
    .replace(/(?:国旗|党旗)/g, "纯色矩形旗帜")
    .replace(/(?:国徽|党徽|组织徽章)/g, "简洁的圆形装饰徽章")
    .replace(/(?:真实明星|真人明星|名人)/g, "原创卡通角色")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 3500);
}

export function buildGenerationPrompt(input: GenerateInput, rewrittenQuery: string) {
  const c = pickCharacterFields(input);
  const taskBranch = buildTaskBranch(input, normalizeWanVisualLanguage(rewrittenQuery));
  const sceneOnly = input.compositionMode === "scene-only";
  const subject = sceneOnly ? `画面主题：纯环境绘本场景。
场景由自然环境、建筑、植物和明确描述的物品构成，层次清晰。` : buildCharacterSubject(input, c);
  return `创作一张温暖、明亮、家庭友好的绘本漫画插图。
输出构图：竖版 3:4，主体清楚，背景简洁，视觉层次自然。
视觉风格：圆润柔和的线条，低饱和马卡龙配色，自然温暖的光线，清晰完整的细节。
画面成品：干净的纯插画，主角整体结构符合其物种和材质设定，场景物件围绕故事主题组织。

${subject}

${taskBranch}`;
}

export async function rewriteQueryWithContext(
  config: RuntimeConfig,
  basePrompt: string,
  options: { referenceDataUrl?: string; previousContext?: string; editIntent?: GenerateInput["editIntent"]; signal?: AbortSignal },
) {
  const instruction = [
    "你是儿童漫画生图请求改写器，不负责生成图片。",
    "请结合当前请求、上一张正式作品及其结构化上下文，把儿童的简短表达改写为清楚、无歧义的中文生图指令。",
    "先从角色类型字段和自由描述中识别主角是人物、机器人、动物、幻想生物还是其他主体。‘儿童友好’只描述内容安全与画风，不代表主角必须是儿童或人类。",
    "主角类型字段为空时，必须以自由描述中的明确主体为准，不得回退成儿童人物。机器人要保持机械头部、机械躯干、机械关节和非皮肤材质；动物要保持物种头部与身体特征；幻想生物要保持其非人类结构。",
    "不得为了可爱而把非人类主角改成人类儿童，也不得仅保留机械手、动物耳朵等局部符号后把其余身体改成人类。用户明确要求拟人化时，也只允许动作和表情拟人化，物种与整体身体结构仍需保持。",
    "不得添加用户没有提出的新人物、新剧情、品牌、文字或危险元素。",
    "如果是局部修改，只改指定字段；角色身份、脸、发型、服装、主色、画风、构图和其他未指定内容应列入lockedFields。",
    "多轮对话中，以最新一轮要求覆盖冲突字段；没有被最新一轮修改的角色、物品、天气和场景要求必须从历史上下文中继承。不得擅自增加人物。",
    "参考图只用于核对主角外观和明确锁定项，图中偶发出现但文字上下文没有要求的实体必须忽略。",
    "如果没有历史图，仍需保持角色卡中的固定特征。",
    "同时提取visualSpec。visualSpec只描述可见的颜色、形状、材质、服装、动作、环境、光线、画风和构图；把组织身份、现实人物、品牌或象征含义转换成等价的中性视觉外观，不在visualSpec中保留其名称。",
    `指定修改类型：${options.editIntent || "新场景"}`,
    `上一轮结构化上下文：${options.previousContext || "无"}`,
    `当前基础指令：\n${basePrompt}`,
    "同时只判断儿童实际提出或选择的情节是否安全。固定安全规则中的禁用词不得作为违规证据；例如‘禁止血腥’本身是安全要求，不能判为风险。",
    "只输出JSON：{\"rewrittenPrompt\":\"本轮完整创作意图\",\"visualSpec\":{\"subject\":\"可见主体\",\"appearance\":\"外观\",\"clothing\":\"服装及颜色形状\",\"scene\":\"环境\",\"action\":\"动作\",\"mood\":\"情绪\",\"props\":[\"物品\"],\"lighting\":\"光线\",\"style\":\"画风\",\"composition\":\"构图\"},\"changedFields\":[\"字段\"],\"lockedFields\":[\"字段\"],\"safe\":true,\"riskType\":null,\"reason\":\"安全或风险判断原因\"}",
  ].join("\n");
  const content: Array<Record<string, unknown>> = [];
  if (options.referenceDataUrl) content.push({ type: "image_url", image_url: { url: options.referenceDataUrl } });
  content.push({ type: "text", text: instruction });
  const endpoint = `https://${getApiHost(config)}/compatible-mode/v1/chat/completions`;
  const response = await fetch(endpoint, {
    signal: options.signal,
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
  return { ...rewrite, visualSpec: normalizeVisualSpec(rewrite.visualSpec) };
}

async function requestWanOnce(config: RuntimeConfig, prompt: string, referenceDataUrl?: string, candidateCount = 2, signal?: AbortSignal) {
  const content: Array<{ text?: string; image?: string }> = [];
  if (referenceDataUrl) content.push({ image: referenceDataUrl });
  content.push({ text: prompt.slice(0, 5000) });
  const endpoint = `https://${getApiHost(config)}/api/v1/services/aigc/multimodal-generation/generation`;
  const response = await fetch(endpoint, {
    signal,
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "wan2.7-image", input: { messages: [{ role: "user", content }] }, parameters: { size: "1536*2048", n: candidateCount, watermark: false } }),
  });
  if (!response.ok) {
    const bodyText = await response.text();
    const error = new Error(formatDashScopeError(response.status, bodyText)) as Error & { status?: number; bodyText?: string; inspection?: boolean };
    error.status = response.status;
    error.bodyText = bodyText;
    error.inspection = /DataInspection|Content|Sensitive/i.test(bodyText);
    throw error;
  }
  const data = await response.json() as { output?: { choices?: Array<{ message?: { content?: Array<{ type?: string; image?: string }> } }> } };
  const urls = data.output?.choices?.flatMap(choice => choice.message?.content || []).filter(item => item.type === "image" && item.image).map(item => item.image as string) || [];
  if (urls.length < candidateCount) throw new Error(`${candidateCount}张候选图片没有完整生成，本次不会计入正式作品`);
  return urls.slice(0, candidateCount);
}

export async function callWan(config: RuntimeConfig, prompt: string, referenceDataUrl?: string, candidateCount = 2, signal?: AbortSignal) {
  const safeCount = Math.max(1, Math.min(2, Math.floor(candidateCount)));
  const normalizedPrompt = normalizeWanVisualLanguage(prompt);
  try {
    return await requestWanOnce(config, normalizedPrompt, referenceDataUrl, safeCount, signal);
  } catch (cause) {
    const error = cause as Error & { inspection?: boolean };
    if (!error.inspection) throw cause;
    const fallbackPrompt = buildStrictWanFallback(normalizedPrompt);
    try {
      return await requestWanOnce(config, fallbackPrompt, referenceDataUrl, safeCount, signal);
    } catch (retryCause) {
      const retryError = retryCause instanceof Error ? retryCause.message : "未知错误";
      throw new Error(`自动转换为中性视觉描述后仍未通过万相检查：${retryError}`);
    }
  }
}

export function buildRefinementPrompt(basePrompt: string, reviewReason: string, rescue = false) {
  return `${basePrompt}

本轮任务：${rescue ? "最终温和补强" : "基于入选初稿进行定向精修"}。
保持初稿中已经正确的主角身份、物种、整体身体结构、材质、主色、画风、故事地点和核心动作。
优先提升主体清晰度、符合其物种的身体结构、构图层次、光线和细节完成度。非人类主角不得在精修时变成人类儿童或只保留局部物种符号。
画面实体严格以原始创作要求为准，只呈现用户明确描述的角色、动物、物品和环境。
评审关注点：${normalizeWanVisualLanguage(reviewReason).slice(0, 300) || "提高整体意图符合度与画面完成度"}。`;
}

export function formatDashScopeError(status: number, bodyText: string) {
  let detail: { code?: string; message?: string; request_id?: string } = {};
  try { detail = JSON.parse(bodyText) as typeof detail; } catch { detail = {}; }
  const code = detail.code || "";
  const message = (detail.message || "").slice(0, 240);
  const requestId = detail.request_id ? `（请求 ID：${detail.request_id}）` : "";
  if (/DataInspection|Content|Sensitive/i.test(`${code} ${message}`)) {
    return `画面描述没有通过万相内容检查。请减少容易产生歧义的词语后再试。${requestId}`;
  }
  if (/InvalidParameter/i.test(code)) {
    return `万相请求参数不符合要求：${message || code}。${requestId}`;
  }
  if (/InvalidApiKey|Unauthorized|AccessDenied/i.test(`${code} ${message}`)) {
    return `百炼密钥或业务空间没有万相模型权限，请检查 API Key 所属地域和模型授权。${requestId}`;
  }
  return `万相生成服务暂时不可用（${status}${code ? ` / ${code}` : ""}）${message ? `：${message}` : ""}${requestId}`;
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

export function buildCandidateEvaluationPrompt(prompt: string, candidateCount: number, options: CandidateEvaluationOptions = {}) {
  const sceneOnly = options.compositionMode === "scene-only" || prompt.includes("画面主题：纯环境绘本场景");
  const expectedSubject = normalizeWanVisualLanguage(options.expectedSubject || "原创卡通主角");
  const allowedEntities = (options.allowedEntities || []).map(value => normalizeWanVisualLanguage(value)).filter(Boolean).slice(0, 12);
  const subjectRule = sceneOnly
    ? "本次是纯场景模式：画面应由环境、建筑、植物和明确物品构成。出现人物、动物角色或拟人化角色属于意图偏差，应将intent降为0；除非它本身含危险内容，否则不要因此把safety降为0。"
    : `本次是带主角模式：画面必须且允许出现主要角色“${expectedSubject}”。这位主要角色是创作目标的一部分，绝不是额外人物，不得仅因出现这位主角而拒绝图片。只有在主要角色之外又出现创作目标没有要求的第二个人物、动物角色、拟人角色或带脸装饰，才算额外实体。若创作目标明确要求多个角色或动物，则这些明确要求的实体同样允许出现。`;
  const allowedRule = allowedEntities.length ? `创作目标明确允许的其他实体：${allowedEntities.join("、")}。` : "创作目标没有列出其他必需实体；请仍以完整创作目标的文字为准。";
  const morphologyRule = options.expectedSubjectKind === "robot"
    ? "主角形态硬检查：预期主角是机器人。头部、躯干、主要关节和四肢都应呈现明确机械结构与非皮肤材质。若主体主要是人类儿童脸、人类皮肤、人类头发和人类躯干，只增加机械手、机械手套、天线或局部金属装饰，必须把character与intent都评为0；机械手不能证明整体是机器人。"
    : options.expectedSubjectKind === "animal"
      ? "主角形态硬检查：预期主角是动物。必须保留明确的动物头部、口鼻或喙、耳朵以及相应身体轮廓和表面材质；若主体主要是人类儿童，只增加动物耳朵或尾巴，必须把character与intent都评为0。"
      : options.expectedSubjectKind === "fantasy"
        ? "主角形态硬检查：预期主角是非人类幻想生物。必须保留创作目标描述的身体结构、材质和标志性器官；若整体被替换成人类儿童，只留下局部装饰，必须把character与intent都评为0。"
        : options.expectedSubjectKind === "neutral"
          ? "主角类型没有被明确指定时，不得自行假定必须是人类儿童；按照创作目标中实际可见的主体特征评分。"
          : "主角形态按创作目标中的人物设定检查。";
  return `你是儿童漫画候选图安全与质量评审器。用户创作目标如下：\n${prompt}\n\n依次检查${candidateCount}张候选图。
${subjectRule}
${morphologyRule}
${allowedRule}
额外实体属于意图符合度和画面质量问题，不等同于儿童安全风险。只有色情、裸露、血腥伤害、恐怖惊吓、危险模仿、个人信息或真实儿童照片感等实际风险，才把safety降为0。
如果出现创作目标未要求的额外人物、动物、拟人化背景、带脸装饰、白色幽灵状小角色或漂浮生物：在reason中明确写“主角之外出现额外实体”，将该图intent降为0并降低quality；不要写“未授权儿童角色”，也不要仅因此把safety降为0。
综合意图符合度、角色特征一致性、画面质量和儿童安全选出唯一最佳图。只输出JSON，不要解释：{"selectedIndex":0,"safe":true,"reason":"简短原因","scores":[{"index":0,"intent":0,"character":0,"quality":0,"safety":0}]}。每项分数0到100；若没有达到门槛的候选，safe=false。`;
}

export async function evaluateCandidates(config: RuntimeConfig, prompt: string, urls: string[], options: CandidateEvaluationOptions = {}, signal?: AbortSignal) {
  const endpoint = `https://${getApiHost(config)}/compatible-mode/v1/chat/completions`;
  const evaluationPrompt = buildCandidateEvaluationPrompt(prompt, urls.length, options);
  const clarification = "重要判定说明：虚构的婴儿、幼儿或儿童卡通角色本身是允许的；名字、圆脸、胖、蘑菇头等虚构角色设定不是个人信息或安全风险。只有画面呈现真实照片、逼真真人肖像或可识别真实儿童时，才按真实儿童照片感降为0。请逐张独立评分，不得因其中一张失败而否定其他安全候选。";
  const content: Array<Record<string, unknown>> = [{ type: "text", text: `${evaluationPrompt}\n${clarification}` }];
  urls.forEach((url, index) => {
    content.push({ type: "text", text: `候选图 ${index}` });
    content.push({ type: "image_url", image_url: { url } });
  });
  const response = await fetch(endpoint, { signal, method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: config.visionModel, messages: [{ role: "user", content }], temperature: 0, response_format: { type: "json_object" } }) });
  if (!response.ok) throw new Error(`视觉评审服务暂时不可用（${response.status}）`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const evaluation = extractJson<CandidateEvaluation>(data.choices?.[0]?.message?.content || "");
  const requiresCharacter = options.compositionMode !== "scene-only" && !prompt.includes("画面主题：纯环境绘本场景");
  const safeScores = (evaluation.scores || []).filter(score => Number.isInteger(score.index) && score.index >= 0 && score.index < urls.length && score.safety >= 80 && score.intent >= 75 && (!requiresCharacter || score.character >= 70));
  if (!safeScores.length) return { ...evaluation, selectedIndex: -1, safe: false, reason: evaluation.reason || `${urls.length}张候选图都没有达到安全与质量阈值` };
  const requested = safeScores.find(score => score.index === Number(evaluation.selectedIndex));
  const best = requested || [...safeScores].sort((a, b) => (b.intent + b.character + b.quality + b.safety) - (a.intent + a.character + a.quality + a.safety))[0];
  return { ...evaluation, selectedIndex: best.index, safe: true, reason: requested ? evaluation.reason : `原入选图未通过安全阈值，已自动改选安全候选图 ${best.index + 1}` };
}

export async function imageUrlToDataUrl(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("历史图片读取失败");
  const mime = response.headers.get("content-type") || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${mime};base64,${bytes.toString("base64")}`;
}
