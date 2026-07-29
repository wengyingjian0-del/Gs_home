"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "home" | "characters" | "character" | "scene" | "generating" | "result" | "chat" | "works" | "parent" | "parentWorks" | "parentIdentity" | "parentPrivacy";
type GenerateInputEdit = "emotion" | "action" | "background" | "extra";
type CompositionMode = "with-character" | "scene-only";
type Choice = { label: string; emoji: string; note?: string };
type Step = { key: string; title: string; hint: string; choices: Choice[] };
type SavedCharacter = { id: string; name: string; appearance: Record<string, string> };
type ArtworkHistory = { id: string; imageUrl: string; referenceKey: string; summary: string; createdAt: string; character: Record<string, string>; scene: Record<string, string>; compositionMode?: CompositionMode; extraDescription: string };
type ChatMessage = { id: string; role: "user" | "assistant"; text?: string; imageUrl?: string; referenceKey?: string; createdAt: string };
type PendingIncomplete = { text: string; chatTurn: boolean };
type FailedGeneration = { text: string; chatTurn: boolean };

function createClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const characterSteps: Step[] = [
  { key: "type", title: "想创造谁？", hint: "先选一个你喜欢的主角类型", choices: [{ label: "勇敢男孩", emoji: "🧒", note: "爱探索" }, { label: "聪明女孩", emoji: "👧", note: "点子多" }, { label: "机器伙伴", emoji: "🤖", note: "未来感" }, { label: "动物朋友", emoji: "🐰", note: "毛茸茸" }] },
  { key: "hair", title: "角色是什么发型？", hint: "这个特征会一直保留", choices: [{ label: "蓬松短发", emoji: "☁️" }, { label: "俏皮双辫", emoji: "🎀" }, { label: "酷酷卷发", emoji: "🌀" }, { label: "戴着帽子", emoji: "🧢" }] },
  { key: "outfit", title: "今天穿什么？", hint: "首版会把这套衣服固定下来", choices: [{ label: "橙色卫衣", emoji: "🍊" }, { label: "蓝色背带裤", emoji: "🫐" }, { label: "绿色探险服", emoji: "🍀" }, { label: "紫色魔法袍", emoji: "🔮" }] },
  { key: "personality", title: "角色是什么性格？", hint: "这会影响表情和小动作", choices: [{ label: "勇敢", emoji: "🦁" }, { label: "好奇", emoji: "🔎" }, { label: "温柔", emoji: "🌷" }, { label: "搞怪", emoji: "😜" }] },
  { key: "style", title: "选择漫画画风", hint: "以后生成新场景也会保持它", choices: [{ label: "清新国漫", emoji: "🎨" }, { label: "可爱绘本", emoji: "🖍️" }, { label: "活力动画", emoji: "⚡" }, { label: "梦幻水彩", emoji: "🌈" }] },
];

const sceneSteps: Step[] = [
  { key: "place", title: "故事发生在哪里？", hint: "选一个今天想去的地方", choices: [{ label: "校园", emoji: "🏫" }, { label: "森林", emoji: "🌲" }, { label: "海边", emoji: "🏖️" }, { label: "梦境", emoji: "🌙" }] },
  { key: "action", title: "主角正在做什么？", hint: "让漫画画面动起来", choices: [{ label: "寻找宝藏", emoji: "🗺️" }, { label: "骑车飞驰", emoji: "🚲" }, { label: "观察昆虫", emoji: "🔍" }, { label: "搭建秘密屋", emoji: "🏡" }] },
  { key: "emotion", title: "主角现在什么心情？", hint: "只改变表情，不改变角色", choices: [{ label: "开心", emoji: "😄" }, { label: "惊喜", emoji: "😮" }, { label: "好奇", emoji: "🤔" }, { label: "自豪", emoji: "😊" }] },
  { key: "extra", title: "加点有趣元素？", hint: "也可以在下面写自己的想法", choices: [{ label: "会说话的小鸟", emoji: "🐦" }, { label: "彩虹风筝", emoji: "🪁" }, { label: "神秘藏宝箱", emoji: "🧰" }, { label: "不添加", emoji: "✨" }] },
  { key: "weather", title: "什么天气和时间？", hint: "为故事选一束合适的光", choices: [{ label: "晴天", emoji: "☀️" }, { label: "雨天", emoji: "🌦️" }, { label: "黄昏", emoji: "🌅" }, { label: "夜晚", emoji: "🌙" }] },
];

const sceneOnlySteps: Step[] = [sceneSteps[0], sceneSteps[3], sceneSteps[4]];

const quickScenes = [
  { label: "校园", className: "campus", color: "coral" },
  { label: "森林", className: "forest", color: "green" },
  { label: "海边", className: "beach", color: "blue" },
  { label: "梦境", className: "dream", color: "purple" },
];

export function CreatorApp() {
  const [view, setView] = useState<View>("home");
  const [step, setStep] = useState(0);
  const [character, setCharacter] = useState<Record<string, string>>({});
  const [draftCharacterName, setDraftCharacterName] = useState("新角色");
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string>();
  const [charactersLoaded, setCharactersLoaded] = useState(false);
  const [scene, setScene] = useState<Record<string, string>>({});
  const [compositionMode, setCompositionMode] = useState<CompositionMode>("with-character");
  const [freeText, setFreeText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [imageUrl, setImageUrl] = useState<string>();
  const [referenceKey, setReferenceKey] = useState<string>();
  const [editIntent, setEditIntent] = useState<GenerateInputEdit>();
  const [error, setError] = useState("");
  const [speechHint, setSpeechHint] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [downloadAllowed, setDownloadAllowed] = useState(false);
  const [childName, setChildName] = useState("小芽");
  const [ageMode, setAgeMode] = useState("8—12岁模式");
  const [artworks, setArtworks] = useState<ArtworkHistory[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [pendingIncomplete, setPendingIncomplete] = useState<PendingIncomplete>();
  const [failedGeneration, setFailedGeneration] = useState<FailedGeneration>();
  const [canRetryGeneration, setCanRetryGeneration] = useState(false);
  const [generationStage, setGenerationStage] = useState("正在启动生成任务");

  const characterReady = Boolean(activeCharacterId && characters.some(item => item.id === activeCharacterId));
  const summary = useMemo(() => [scene.place, scene.action, scene.emotion, scene.extra, scene.weather, freeText].filter(Boolean).join(" · "), [scene, freeText]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("manhua-characters") || "[]") as SavedCharacter[];
      const activeId = localStorage.getItem("manhua-active-character") || saved[0]?.id;
      const active = saved.find(item => item.id === activeId) || saved[0];
      setCharacters(saved);
      setActiveCharacterId(active?.id);
      setCharacter(active?.appearance || {});
      setChildName(localStorage.getItem("manhua-child-name") || "小芽");
      setAgeMode(localStorage.getItem("manhua-age-mode") || "8—12岁模式");
      setDownloadAllowed(localStorage.getItem("manhua-download-allowed") === "true");
      setArtworks(JSON.parse(localStorage.getItem("manhua-artworks") || "[]") as ArtworkHistory[]);
      setChatMessages(JSON.parse(localStorage.getItem("manhua-chat-messages") || "[]") as ChatMessage[]);
    } catch {
      localStorage.removeItem("manhua-characters");
      localStorage.removeItem("manhua-active-character");
    } finally {
      setCharactersLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!charactersLoaded) return;
    localStorage.setItem("manhua-characters", JSON.stringify(characters));
    if (activeCharacterId) localStorage.setItem("manhua-active-character", activeCharacterId);
    else localStorage.removeItem("manhua-active-character");
  }, [characters, activeCharacterId, charactersLoaded]);

  useEffect(() => {
    if (!charactersLoaded) return;
    localStorage.setItem("manhua-artworks", JSON.stringify(artworks));
  }, [artworks, charactersLoaded]);

  useEffect(() => {
    if (!charactersLoaded) return;
    localStorage.setItem("manhua-chat-messages", JSON.stringify(chatMessages));
  }, [chatMessages, charactersLoaded]);

  function saveIdentity(name: string, mode: string) {
    const cleanName = name.trim() || "小芽";
    setChildName(cleanName);
    setAgeMode(mode);
    localStorage.setItem("manhua-child-name", cleanName);
    localStorage.setItem("manhua-age-mode", mode);
    setView("parent");
  }

  function toggleDownloads() {
    const next = !downloadAllowed;
    setDownloadAllowed(next);
    localStorage.setItem("manhua-download-allowed", String(next));
  }

  function deleteArtwork() {
    if (!window.confirm("确定删除当前作品吗？删除后无法恢复。")) return;
    setImageUrl(undefined);
    setReferenceKey(undefined);
    setFavorite(false);
    setArtworks(previous => previous.filter(item => item.referenceKey !== referenceKey));
    setView("parentWorks");
  }

  function openHistoricalArtwork(item: ArtworkHistory) {
    setImageUrl(item.imageUrl);
    setReferenceKey(item.referenceKey);
    setCharacter(item.character);
    setScene(item.scene);
    setCompositionMode(item.compositionMode || "with-character");
    setFreeText(item.extraDescription);
    setEditIntent(undefined);
    setView("result");
  }

  function editHistoricalArtwork(item: ArtworkHistory) {
    setImageUrl(item.imageUrl);
    setReferenceKey(item.referenceKey);
    setCharacter(item.character);
    setScene(item.scene);
    setCompositionMode(item.compositionMode || "with-character");
    setFreeText(item.extraDescription);
    setEditIntent("extra");
    setChatInput("");
    setView("chat");
  }

  function clearLocalData() {
    if (!window.confirm("确定清除这台设备上的角色、身份设置和当前作品吗？此操作无法恢复。")) return;
    localStorage.removeItem("manhua-characters");
    localStorage.removeItem("manhua-active-character");
    localStorage.removeItem("manhua-child-name");
    localStorage.removeItem("manhua-age-mode");
    localStorage.removeItem("manhua-download-allowed");
    setCharacters([]);
    setCharacter({});
    setActiveCharacterId(undefined);
    setImageUrl(undefined);
    setReferenceKey(undefined);
    setChildName("小芽");
    setAgeMode("8—12岁模式");
    setDownloadAllowed(false);
    setArtworks([]);
    setChatMessages([]);
    localStorage.removeItem("manhua-artworks");
    localStorage.removeItem("manhua-chat-messages");
    setView("parent");
  }

  function createCharacter() {
    setCharacter({});
    setDraftCharacterName(`小芽${characters.length ? characters.length + 1 : ""}`);
    setActiveCharacterId(undefined);
    openWizard("character");
  }

  function saveCharacter() {
    const id = activeCharacterId || createClientId();
    setCharacters(previous => {
      const existingIndex = previous.findIndex(item => item.id === id);
      const fallbackName = existingIndex >= 0 ? previous[existingIndex].name : `小芽${previous.length ? previous.length + 1 : ""}`;
      const saved = { id, name: draftCharacterName.trim().slice(0, 20) || fallbackName, appearance: { ...character } };
      return existingIndex >= 0 ? previous.map(item => item.id === id ? saved : item) : [...previous, saved];
    });
    setActiveCharacterId(id);
    setView("characters");
    setStep(0);
  }

  function selectCharacter(item: SavedCharacter) {
    setActiveCharacterId(item.id);
    setCharacter(item.appearance);
    setDraftCharacterName(item.name);
  }

  function deleteCharacter(id: string) {
    if (!window.confirm("确定删除这个角色吗？已生成的漫画不会被删除。")) return;
    const remaining = characters.filter(item => item.id !== id);
    setCharacters(remaining);
    if (activeCharacterId === id) {
      setActiveCharacterId(remaining[0]?.id);
      setCharacter(remaining[0]?.appearance || {});
    }
  }

  function openWizard(kind: "character" | "scene", startAt = 0) {
    setStep(startAt);
    setError("");
    setSpeechHint("");
    if (kind === "scene") {
      setReferenceKey(undefined);
      setEditIntent(undefined);
      setChatMessages([]);
    }
    setView(kind);
  }

  function chooseQuickScene(place: string) {
    setCompositionMode("with-character");
    setScene(current => ({ ...current, place }));
    openWizard("scene", 0);
  }

  function startCharacterCreation() {
    setCompositionMode("with-character");
    openWizard(characterReady ? "scene" : "character");
  }

  function startSceneOnly() {
    setCompositionMode("scene-only");
    setReferenceKey(undefined);
    setEditIntent(undefined);
    setScene({});
    openWizard("scene");
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setFreeText(searchText.trim());
    startCharacterCreation();
  }

  function startVoice(target: "character" | "scene" = "scene") {
    type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; start(): void; onresult: (event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void; onerror: () => void; onend: () => void };
    type RecognitionConstructor = new () => Recognition;
    const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const RecognitionApi = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!RecognitionApi) { setSpeechHint("当前浏览器不支持语音，可以直接打字告诉我。"); return; }
    const recognition = new RecognitionApi();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setSpeechHint("正在听，请说出你的想法……");
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      if (target === "character") setCharacter(value => ({ ...value, description: `${value.description || ""}${value.description ? "，" : ""}${transcript}` }));
      else setFreeText(value => `${value}${value ? "，" : ""}${transcript}`);
    };
    recognition.onerror = () => setSpeechHint("刚才没有听清，可以再说一次或直接打字。");
    recognition.onend = () => setSpeechHint(value => value.startsWith("正在") ? "语音已经填进描述里了。" : value);
    recognition.start();
  }

  async function generate(instruction?: string, chatTurn = false, allowIncomplete = false, reusePending = false) {
    const requestText = (instruction ?? freeText).trim();
    if (chatTurn && !requestText) return;
    if (!allowIncomplete) setPendingIncomplete(undefined);
    if (chatTurn && !reusePending) {
      setChatMessages(previous => [...previous, { id: createClientId(), role: "user", text: requestText, createdAt: new Date().toISOString() }]);
      setChatInput("");
      setFreeText(requestText);
      setEditIntent("extra");
    }
    setView("generating");
    setError("");
    setCanRetryGeneration(false);
    setGenerationStage("正在理解故事和角色设定");
    const jobId = createClientId();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    const poll = window.setInterval(async () => {
      try {
        const statusResponse = await fetch(`/api/generate/status/${jobId}`, { cache: "no-store" });
        if (!statusResponse.ok) return;
        const status = await statusResponse.json() as { label?: string };
        if (status.label) setGenerationStage(status.label);
      } catch { /* 轮询失败不影响主生成请求 */ }
    }, 1_500);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, character, scene, compositionMode, allowIncomplete, extraDescription: requestText, referenceKey, editIntent: chatTurn ? "extra" : editIntent, conversationContext: [...chatMessages.filter(message => message.role === "user" && message.text).map(message => message.text), requestText].filter(Boolean).slice(-12).join(" → ") }),
      });
      const data = await response.json() as { imageUrl?: string; referenceKey?: string; message?: string; code?: string; canContinue?: boolean; canRetry?: boolean; missingFields?: string[] };
      if (!response.ok && data.code === "CLARIFICATION_REQUIRED" && data.canContinue) {
        setPendingIncomplete({ text: requestText, chatTurn });
        setError(data.message || "可以补充更多特点，也可以按当前描述继续生成。");
        setView(chatTurn ? "chat" : "scene");
        if (!chatTurn) setStep((compositionMode === "scene-only" ? sceneOnlySteps : sceneSteps).length - 1);
        return;
      }
      if (!response.ok || !data.imageUrl) {
        setCanRetryGeneration(Boolean(data.canRetry));
        throw new Error(data.message || "这次没有生成正式图片，请再试一次。" );
      }
      setPendingIncomplete(undefined);
      setFailedGeneration(undefined);
      setImageUrl(data.imageUrl);
      setReferenceKey(data.referenceKey);
      if (data.referenceKey) {
        const item: ArtworkHistory = { id: createClientId(), imageUrl: data.imageUrl, referenceKey: data.referenceKey, summary: requestText || summary, createdAt: new Date().toISOString(), character: { ...character }, scene: { ...scene }, compositionMode, extraDescription: requestText };
        setArtworks(previous => [item, ...previous.filter(old => old.referenceKey !== item.referenceKey)]);
        setChatMessages(previous => [...previous, { id: createClientId(), role: "assistant", text: chatTurn ? "已经按照你的新要求画好了。" : "基础场景画好了，可以继续告诉我怎么修改。", imageUrl: data.imageUrl, referenceKey: data.referenceKey, createdAt: new Date().toISOString() }]);
      }
      setView("chat");
    } catch (cause) {
      const clientTimedOut = cause instanceof DOMException && cause.name === "AbortError";
      setCanRetryGeneration(value => value || clientTimedOut);
      setFailedGeneration({ text: requestText, chatTurn });
      setError(clientTimedOut ? "这次生成已达到3分钟上限，已经停止等待。请点击重新生成。" : cause instanceof Error ? cause.message : "这次魔法没有成功，请再试一次。" );
      setView(chatTurn ? "chat" : "scene");
      if (!chatTurn) setStep(sceneSteps.length - 1);
    } finally {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
    }
  }

  function downloadArtwork() {
    if (!downloadAllowed) { setError("家长还没有开启下载权限。可以先收藏作品，请家长在设置页开启。"); return; }
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `画芽作品-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (view === "character" || view === "scene") {
    const isCharacter = view === "character";
    const steps = isCharacter ? characterSteps : compositionMode === "scene-only" ? sceneOnlySteps : sceneSteps;
    const values = isCharacter ? character : scene;
    const currentStep = Math.max(0, Math.min(step, steps.length - 1));
    const current = steps[currentStep];
    const choose = (label: string) => isCharacter
      ? setCharacter(previous => ({ ...previous, [current.key]: label }))
      : setScene(previous => ({ ...previous, [current.key]: label }));
    const advance = () => {
      if (currentStep < steps.length - 1) setStep(currentStep + 1);
      else if (isCharacter) saveCharacter();
      else generate();
    };
    const skip = () => {
      choose(current.key === "extra" ? "不添加" : current.key === "weather" ? "无" : "");
      advance();
    };

    return <main className="app-shell wizard-shell">
      <header className="wizard-header">
        <button className="round-icon" aria-label="返回" onClick={() => currentStep ? setStep(currentStep - 1) : setView("home")}>‹</button>
        <div className="wizard-heading"><strong>{isCharacter ? "创建漫画主角" : "创作漫画场景"}</strong><span>{currentStep + 1} / {steps.length}</span></div>
        <button className="skip-top" onClick={skip}>跳过</button>
      </header>
      <div className="soft-progress"><i style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }} /></div>
      <section className="wizard-content">
        {!isCharacter && <div className="mode-switch" role="group" aria-label="画面生成模式"><button className={compositionMode === "with-character" ? "active" : ""} onClick={() => { setCompositionMode("with-character"); setStep(0); }}>带主角</button><button className={compositionMode === "scene-only" ? "active" : ""} onClick={() => { setCompositionMode("scene-only"); setStep(0); }}>只画场景</button></div>}
        <div className="helper-card">
          <div className="helper-avatar"><Image unoptimized src="/assets/character-builder.webp" alt="画芽小助手" fill sizes="56px" /></div>
          <div><span>画芽小助手</span><h1>{current.title}</h1><p>{current.hint}</p></div>
        </div>
        <div className="choice-grid">
          {current.choices.map((choice, index) => <button key={choice.label} className={`choice-card tone-${index + 1} ${values[current.key] === choice.label ? "selected" : ""}`} onClick={() => choose(choice.label)}>
            <span className="choice-emoji">{choice.emoji}</span>
            <strong>{choice.label}</strong>
            {choice.note && <small>{choice.note}</small>}
            <i className="choice-check">✓</i>
          </button>)}
        </div>
        {(current.key === "extra" || current.key === "style") && <div className="idea-box">
          <textarea maxLength={120} value={isCharacter ? character.description || "" : freeText} onChange={event => isCharacter ? setCharacter(previous => ({ ...previous, description: event.target.value })) : setFreeText(event.target.value)} placeholder={current.key === "extra" ? "还可以说：旁边有一只戴眼镜的松鼠……" : "补充主角的外观、材质或标志性特点……"} />
          <button type="button" onClick={() => startVoice(isCharacter ? "character" : "scene")}>🎙 语音说</button>
          {speechHint && <small>{speechHint}</small>}
        </div>}
        {isCharacter && current.key === "style" && <label className="character-name-field"><span>给角色起个名字</span><input maxLength={20} value={draftCharacterName} onChange={event => setDraftCharacterName(event.target.value)} placeholder="例如：小雨" /></label>}
        {error && <div className="friendly-error"><b>{pendingIncomplete ? "还可以补充一些特点" : "这次没有画出来"}</b><span>{error}</span>{pendingIncomplete && <button className="continue-anyway" onClick={() => generate(pendingIncomplete.text, pendingIncomplete.chatTurn, true, true)}>仍然按当前描述生成</button>}{canRetryGeneration && failedGeneration && !pendingIncomplete && <button className="continue-anyway" onClick={() => generate(failedGeneration.text, failedGeneration.chatTurn, true, true)}>重新生成</button>}</div>}
      </section>
      <footer className="wizard-footer">
        <button className="ghost-button" onClick={skip}>跳过这一步</button>
        <button className="pink-button" onClick={advance}>{currentStep === steps.length - 1 ? (isCharacter ? "保存主角" : "生成漫画") : "下一步"}<span>→</span></button>
      </footer>
    </main>;
  }

  if (view === "chat") return <ChatCreationPage messages={chatMessages} value={chatInput} currentReferenceKey={referenceKey} error={error} canContinue={Boolean(pendingIncomplete)} canRetry={canRetryGeneration && Boolean(failedGeneration)} onChange={setChatInput} onSend={() => generate(chatInput, true)} onContinue={() => pendingIncomplete && generate(pendingIncomplete.text, pendingIncomplete.chatTurn, true, true)} onRetry={() => failedGeneration && generate(failedGeneration.text, failedGeneration.chatTurn, true, true)} onBack={() => setView("home")} onHistory={() => setView("works")} onUseVersion={key => { const item = artworks.find(artwork => artwork.referenceKey === key); if (item) editHistoricalArtwork(item); }} />;

  if (view === "generating") return <main className="app-shell generation-page">
    <div className="generation-art"><Image unoptimized src="/assets/comic-creator.webp" alt="正在生成漫画" fill priority sizes="430px" /></div>
    <span className="mini-label">AI 正在认真画画</span>
    <h1>你的故事正在变成漫画</h1>
    <p>{generationStage}</p>
    <small>系统会绘制两张初稿；整次生成最长等待3分钟，某一步超时会在剩余时间内自动重试。</small>
    <div className="paint-dots"><i/><i/><i/><i/></div>
  </main>;

  if (view === "result" && imageUrl) return <main className="app-shell result-page">
    <header className="simple-header"><button className="round-icon" onClick={() => setView("home")}>‹</button><strong>生成成功</strong><button className={`round-icon ${favorite ? "loved" : ""}`} onClick={() => setFavorite(!favorite)}>{favorite ? "♥" : "♡"}</button></header>
    <section className="result-wrap">
      <div className="success-chip"><span>✓</span> 你的漫画完成啦</div>
      <div className="result-frame"><Image src={imageUrl} alt={summary || "生成的儿童漫画场景"} fill unoptimized sizes="(max-width: 480px) 90vw, 400px" /></div>
      <p className="result-summary">{summary}</p>
      <div className="edit-tools">
        <button onClick={() => { setEditIntent("emotion"); setStep(2); setView("scene"); }}><span>😊</span>改表情</button>
        <button onClick={() => { setEditIntent("action"); setStep(1); setView("scene"); }}><span>🏃</span>改动作</button>
        <button onClick={() => { setEditIntent("background"); setStep(0); setView("scene"); }}><span>🏞</span>换背景</button>
        <button onClick={() => { setEditIntent("extra"); setStep(3); setView("scene"); }}><span>✨</span>改细节</button>
      </div>
      {error && <div className="friendly-error"><span>{error}</span></div>}
      <div className="result-buttons"><button className="ghost-button" onClick={downloadArtwork}>下载</button><button className="pink-button" onClick={() => setView("works")}>保存到作品集</button></div>
    </section>
  </main>;

  if (view === "parentWorks") return <ParentWorksPage imageUrl={imageUrl} summary={summary} onBack={() => setView("parent")} onDelete={deleteArtwork} />;
  if (view === "parentIdentity") return <IdentityPage initialName={childName} initialMode={ageMode} onBack={() => setView("parent")} onSave={saveIdentity} />;
  if (view === "parentPrivacy") return <PrivacyPage onBack={() => setView("parent")} onClear={clearLocalData} />;

  const activeTab = view === "characters" ? "characters" : view === "works" ? "works" : view === "parent" ? "parent" : "home";
  return <main className="app-shell main-page">
    <header className="home-header">
      <form className="story-search" onSubmit={submitSearch}><span>⌕</span><input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="输入一个小故事" aria-label="输入一个小故事" /></form>
      <button className="message-button" aria-label="创作提示">♡<i>1</i></button>
    </header>

    <div className="page-scroll">
      {view === "home" && <HomePage characterReady={characterReady} onCharacter={() => { const active = characters.find(item => item.id === activeCharacterId); setDraftCharacterName(active?.name || "小芽"); openWizard("character"); }} onCreate={startCharacterCreation} onSceneOnly={startSceneOnly} onScene={chooseQuickScene} />}
      {view === "characters" && <SavedCharactersPage characters={characters} activeCharacterId={activeCharacterId} onCreate={createCharacter} onSelect={selectCharacter} onDelete={deleteCharacter} onEdit={item => { selectCharacter(item); openWizard("character"); }} onScene={startCharacterCreation} />}
      {view === "works" && <HistoryWorksPage artworks={artworks} onOpen={openHistoricalArtwork} onEdit={editHistoricalArtwork} onCreate={startCharacterCreation} />}
      {view === "parent" && <ParentPage childName={childName} ageMode={ageMode} downloadAllowed={downloadAllowed} onWorks={() => setView("parentWorks")} onIdentity={() => setView("parentIdentity")} onDownload={toggleDownloads} onPrivacy={() => setView("parentPrivacy")} />}
    </div>

    <nav className="tabbar" aria-label="主导航">
      <button className={activeTab === "home" ? "active" : ""} onClick={() => setView("home")}><span>⌂</span>首页</button>
      <button className={activeTab === "characters" ? "active" : ""} onClick={() => setView("characters")}><span>☺</span>角色</button>
      <button className="create-tab" onClick={startCharacterCreation}><span>♡</span>创作</button>
      <button className={activeTab === "works" ? "active" : ""} onClick={() => setView("works")}><span>▱</span>作品集</button>
      <button className={activeTab === "parent" ? "active" : ""} onClick={() => setView("parent")}><span>⚙</span>设置</button>
    </nav>
  </main>;
}

function HomePage({ characterReady, onCharacter, onCreate, onSceneOnly, onScene }: { characterReady: boolean; onCharacter(): void; onCreate(): void; onSceneOnly(): void; onScene(place: string): void }) {
  return <>
    <section className="character-hero">
      <div className="hero-copy"><span className="sparkle">✦ 我的漫画主角</span><h1>{characterReady ? "主角已准备好啦！" : "先创建一个主角吧"}</h1><button onClick={characterReady ? onCharacter : onCreate}>{characterReady ? "查看角色卡" : "开始创建"}<span>→</span></button></div>
      <div className="hero-art"><Image unoptimized src={characterReady ? "/assets/comic-creator.webp" : "/assets/empty-character.webp"} alt="我的漫画主角" fill priority sizes="220px" /></div>
      <div className="carousel-dots"><i/><i/><i/></div>
    </section>
    <a className="four-comic-entry" href="/four-comic"><span>▦</span><div><b>四格漫画工作室</b><small>选择一个角色，AI自动创作故事、分镜和对白</small></div><i>›</i></a>
    <div className="section-heading"><div><span>选择故事地点</span><h2>今天去哪里冒险？</h2></div><div className="scene-heading-actions"><button onClick={onSceneOnly}>只画场景</button><button onClick={onCreate}>自由创作 →</button></div></div>
    <section className="scene-grid">
      {quickScenes.map(item => <button key={item.label} className={`scene-card ${item.className} ${item.color}`} onClick={() => onScene(item.label)}><div className="scene-crop"><Image unoptimized src="/assets/scenes-grid.webp" alt={item.label} fill sizes="190px" /></div><strong>{item.label}</strong><span>去看看 →</span></button>)}
    </section>
    <button className="tip-banner" onClick={onCreate}><span>⌄</span><b>选择场景和动作，AI会保持主角不变</b><i>→</i></button>
  </>;
}

function getCharacterIdentity(appearance: Record<string, string>) {
  const source = `${appearance.type || ""} ${appearance.description || ""}`;
  if (/机器|机器人|机械|机甲/i.test(source)) return { emoji: "🤖", label: appearance.type || "机器人主角", tone: "robot" };
  if (/动物|猫|狗|兔|熊|狐狸|鸟/i.test(source)) return { emoji: "🐾", label: appearance.type || "动物主角", tone: "animal" };
  if (/女孩|少女|女生/i.test(source)) return { emoji: "👧", label: appearance.type || "女孩主角", tone: "girl" };
  if (/男孩|少年|男生/i.test(source)) return { emoji: "🧒", label: appearance.type || "男孩主角", tone: "boy" };
  return { emoji: "✦", label: appearance.type || "主角类型未记录", tone: "unknown" };
}

function CharacterIdentityPanel({ appearance }: { appearance: Record<string, string> }) {
  const identity = getCharacterIdentity(appearance);
  const details = [
    ["外观特征", appearance.hair],
    ["固定服装", appearance.outfit],
    ["性格", appearance.personality],
    ["画风", appearance.style],
  ];
  return <>
    <div className={`character-identity-visual ${identity.tone}`}>
      <span>MAIN CHARACTER</span>
      <strong>{identity.emoji}</strong>
      <div><small>主角类型</small><b>{identity.label}</b></div>
    </div>
    <dl className="character-facts">
      {details.map(([label, value]) => <div className={!value ? "missing" : ""} key={label}><dt>{label}</dt><dd>{value || "未设置"}</dd></div>)}
    </dl>
    {appearance.description && <p className="character-description"><b>补充设定</b><span>{appearance.description}</span></p>}
    {!appearance.type && <p className="character-missing-warning">这张旧角色卡没有保存主角类型，请点“补充资料”确认它是机器人、人物还是动物。</p>}
  </>;
}

function SavedCharactersPage({ characters, activeCharacterId, onCreate, onSelect, onDelete, onEdit, onScene }: { characters: SavedCharacter[]; activeCharacterId?: string; onCreate(): void; onSelect(item: SavedCharacter): void; onDelete(id: string): void; onEdit(item: SavedCharacter): void; onScene(): void }) {
  return <>
    <div className="title-block"><span>我的主角</span><h1>角色卡</h1><p>每张卡都会明确显示主角类型和固定设定。点击卡片可切换当前主角。</p></div>
    {characters.length ? <div className="character-list">{characters.map(item => <section className={`profile-card ${item.id === activeCharacterId ? "active-character" : ""}`} key={item.id} onClick={() => onSelect(item)}>
      <div className="profile-copy"><div className="character-card-title"><span className="status-dot">{item.id === activeCharacterId ? "当前主角" : "已保存"}</span><div><small>角色名称</small><h2>{item.name}</h2></div></div>
        <CharacterIdentityPanel appearance={item.appearance} />
        <div className="character-edit-row"><button onClick={event => { event.stopPropagation(); onEdit(item); }}>{item.appearance.type ? "编辑资料" : "补充资料"}</button></div>
        <div className="character-actions"><button className="delete-character" onClick={event => { event.stopPropagation(); onDelete(item.id); }}>删除角色</button><button className="pink-button" onClick={event => { event.stopPropagation(); onSelect(item); onScene(); }}>用这个主角创作</button></div>
      </div>
    </section>)}</div> : <section className="empty-card"><div><Image unoptimized src="/assets/empty-character.webp" alt="创建漫画主角" fill sizes="380px" /></div><h2>还没有漫画主角</h2><p>用几次简单选择，创造一个独一无二的角色。</p><button className="pink-button" onClick={onCreate}>创建第一个主角</button></section>}
    <button className="outline-wide" onClick={onCreate}>＋ 创建新角色</button>
  </>;
}

function CharactersPage({ characterReady, character, onCreate, onScene }: { characterReady: boolean; character: Record<string, string>; onCreate(): void; onScene(): void }) {
  return <>
    <div className="title-block"><span>我的主角</span><h1>角色卡</h1><p>主角的脸、发型、服装和画风会一直保持一致。</p></div>
    {characterReady ? <section className="profile-card"><div className="profile-image"><Image unoptimized src="/assets/character-builder.webp" alt="已保存的漫画主角" fill sizes="380px" /></div><div className="profile-copy"><div><span className="status-dot">已锁定</span><h2>小芽</h2><p>{[character.hair, character.outfit, character.style].filter(Boolean).join(" · ") || "使用安全默认形象"}</p></div><button className="pink-button" onClick={onScene}>用这个角色创作</button></div></section> : <section className="empty-card"><div><Image unoptimized src="/assets/empty-character.webp" alt="创建漫画主角" fill sizes="380px" /></div><h2>还没有漫画主角</h2><p>用几次简单选择，创造一个独一无二的角色。</p><button className="pink-button" onClick={onCreate}>创建第一个主角</button></section>}
    <button className="outline-wide" onClick={onCreate}>＋ 创建新角色</button>
  </>;
}

function ChatCreationPage({ messages, value, currentReferenceKey, error, canContinue, canRetry, onChange, onSend, onContinue, onRetry, onBack, onHistory, onUseVersion }: { messages: ChatMessage[]; value: string; currentReferenceKey?: string; error: string; canContinue: boolean; canRetry: boolean; onChange(value: string): void; onSend(): void; onContinue(): void; onRetry(): void; onBack(): void; onHistory(): void; onUseVersion(key: string): void }) {
  const suggestions = ["让主角开心一点", "换成下雨天", "保持人物不变，增加一只小猫", "把背景改成夜晚"];
  return <main className="app-shell chat-page">
    <header className="chat-header"><button className="round-icon" aria-label="返回首页" onClick={onBack}>‹</button><div><strong>对话改图</strong><small>会一直参考当前图片和前文</small></div><button className="chat-history" onClick={onHistory}>历史</button></header>
    <section className="chat-thread">
      {!messages.length && <div className="chat-welcome"><b>基础场景准备好后，就可以一直和我对话改图。</b><p>比如：“人物不要变，把背景换成下雨天。”</p></div>}
      {messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}>
        {message.text && <p>{message.text}</p>}
        {message.imageUrl && <div className="chat-image"><Image src={message.imageUrl} alt="对话生成的漫画" fill unoptimized sizes="390px" /></div>}
        {message.referenceKey && <button className={message.referenceKey === currentReferenceKey ? "current-version" : ""} onClick={() => onUseVersion(message.referenceKey!)}>{message.referenceKey === currentReferenceKey ? "✓ 当前参考版本" : "从这个版本继续"}</button>}
      </div>)}
      {error && <div className="friendly-error"><b>{canContinue ? "描述还可以更具体" : "这次没有生成成功"}</b><span>{error}</span>{canContinue && <button className="continue-anyway" onClick={onContinue}>仍然按当前描述生成</button>}{canRetry && !canContinue && <button className="continue-anyway" onClick={onRetry}>重新生成</button>}</div>}
    </section>
    <footer className="chat-composer"><div className="chat-suggestions">{suggestions.map(text => <button key={text} onClick={() => onChange(text)}>{text}</button>)}</div><div className="chat-input-row"><textarea rows={2} maxLength={240} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); } }} placeholder="继续说你想怎么修改……" /><button disabled={!value.trim()} onClick={onSend}>发送</button></div></footer>
  </main>;
}

function HistoryWorksPage({ artworks, onOpen, onEdit, onCreate }: { artworks: ArtworkHistory[]; onOpen(item: ArtworkHistory): void; onEdit(item: ArtworkHistory): void; onCreate(): void }) {
  return <>
    <div className="title-block"><span>我的创作历史</span><h1>漫画作品集</h1><p>可以打开任意历史图片，也可以引用它继续多轮修改。</p></div>
    {artworks.length ? <div className="history-list">{artworks.map((item, index) => <article className="history-card" key={item.id}>
      <button className="history-image" onClick={() => onOpen(item)}><Image src={item.imageUrl} alt={`历史作品 ${index + 1}`} fill unoptimized sizes="380px" /></button>
      <div className="history-copy"><div><b>{index ? `历史版本 ${artworks.length - index}` : "最新版本"}</b><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small><p>{item.summary || "我的漫画故事"}</p></div><button className="reference-button" onClick={() => onEdit(item)}>引用这张图继续修改</button></div>
    </article>)}</div> : <section className="empty-card works-empty"><div><Image unoptimized src="/assets/success.webp" alt="作品集" fill sizes="380px" /></div><h2>作品集还是空的</h2><p>完成第一张漫画后，它会出现在这里。</p><button className="pink-button" onClick={onCreate}>开始画故事</button></section>}
  </>;
}

function WorksPage({ imageUrl, summary, onOpen, onCreate }: { imageUrl?: string; summary: string; onOpen(): void; onCreate(): void }) {
  return <>
    <div className="title-block"><span>我的收藏夹</span><h1>漫画作品集</h1><p>每一次创作和历史版本都会安全保存在这里。</p></div>
    {imageUrl ? <button className="work-tile" onClick={onOpen}><div>{<Image src={imageUrl} alt="最近生成的漫画" fill unoptimized sizes="380px" />}</div><span><b>最新作品</b><small>{summary || "我的漫画故事"}</small></span><i>♡</i></button> : <section className="empty-card works-empty"><div><Image unoptimized src="/assets/success.webp" alt="作品集" fill sizes="380px" /></div><h2>作品集还是空的</h2><p>完成第一张漫画后，它会出现在这里。</p><button className="pink-button" onClick={onCreate}>开始画故事</button></section>}
  </>;
}

function ParentWorksPage({ imageUrl, summary, onBack, onDelete }: { imageUrl?: string; summary: string; onBack(): void; onDelete(): void }) {
  return <main className="app-shell main-page"><SubpageHeader title="儿童作品管理" onBack={onBack} /><div className="page-scroll parent-subpage">
    {imageUrl ? <section className="managed-work"><div><Image src={imageUrl} alt="当前漫画作品" fill unoptimized sizes="400px" /></div><h2>当前作品</h2><p>{summary || "孩子创作的漫画故事"}</p><button className="danger-wide" onClick={onDelete}>删除这幅作品</button></section> : <div className="admin-empty">目前没有可以管理的作品。</div>}
  </div></main>;
}

function IdentityPage({ initialName, initialMode, onBack, onSave }: { initialName: string; initialMode: string; onBack(): void; onSave(name: string, mode: string): void }) {
  const [name, setName] = useState(initialName);
  const [mode, setMode] = useState(initialMode);
  return <main className="app-shell main-page"><SubpageHeader title="儿童身份" onBack={onBack} /><div className="page-scroll parent-subpage"><section className="parent-form">
    <label>孩子昵称<input maxLength={12} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>年龄模式<select value={mode} onChange={event => setMode(event.target.value)}><option>6—7岁模式</option><option>8—12岁模式</option><option>13—15岁模式</option></select></label>
    <p>年龄模式用于调整界面提示和内容安全规则，不需要填写真实姓名或生日。</p>
    <button className="pink-button" onClick={() => onSave(name, mode)}>保存身份设置</button>
  </section></div></main>;
}

function PrivacyPage({ onBack, onClear }: { onBack(): void; onClear(): void }) {
  return <main className="app-shell main-page"><SubpageHeader title="隐私与数据" onBack={onBack} /><div className="page-scroll parent-subpage"><section className="privacy-card"><h2>数据保存在这台设备上</h2><p>角色卡、儿童昵称和家长设置保存在当前浏览器中。漫画图片由服务端图片存储提供。</p><h3>安全说明</h3><p>请不要输入真实姓名、学校、住址、联系方式，也不要上传真实儿童照片。</p><button className="danger-wide" onClick={onClear}>清除这台设备上的数据</button></section></div></main>;
}

function SubpageHeader({ title, onBack }: { title: string; onBack(): void }) {
  return <header className="simple-header"><button className="round-icon" aria-label="返回" onClick={onBack}>‹</button><strong>{title}</strong><span /></header>;
}

function ParentPage({ childName, ageMode, downloadAllowed, onWorks, onIdentity, onDownload, onPrivacy }: { childName: string; ageMode: string; downloadAllowed: boolean; onWorks(): void; onIdentity(): void; onDownload(): void; onPrivacy(): void }) {
  return <>
    <div className="title-block"><span>家长空间</span><h1>安全与管理</h1><p>管理儿童身份、作品权限和隐私授权。</p></div>
    <div className="parent-visual"><Image unoptimized src="/assets/parent-menu.webp" alt="家长管理" fill sizes="380px" /></div>
    <section className="settings-list">
      <button onClick={onWorks}><span className="setting-icon blue">▧</span><div><b>查看儿童作品</b><small>查看和删除全部创作记录</small></div><i>›</i></button>
      <button onClick={onIdentity}><span className="setting-icon peach">☺</span><div><b>儿童身份</b><small>{childName} · {ageMode}</small></div><i>›</i></button>
      <button onClick={onDownload}><span className="setting-icon pink">⇩</span><div><b>允许下载作品</b><small>{downloadAllowed ? "已开启" : "当前关闭"}</small></div><span className={`soft-toggle ${downloadAllowed ? "on" : ""}`}><i/></span></button>
      <button onClick={onPrivacy}><span className="setting-icon green">♢</span><div><b>隐私与数据</b><small>查看数据说明或清除本机数据</small></div><i>›</i></button>
    </section>
  </>;
}

function ParentPageLegacy({ downloadAllowed, onDownload }: { downloadAllowed: boolean; onDownload(): void }) {
  return <>
    <div className="title-block"><span>家长空间</span><h1>安全与管理</h1><p>管理儿童身份、作品权限和隐私授权。</p></div>
    <div className="parent-visual"><Image unoptimized src="/assets/parent-menu.webp" alt="家长管理" fill sizes="380px" /></div>
    <section className="settings-list">
      <button><span className="setting-icon blue">▧</span><div><b>查看儿童作品</b><small>查看和删除全部创作记录</small></div><i>›</i></button>
      <button><span className="setting-icon peach">☺</span><div><b>儿童身份</b><small>小芽 · 8—12岁模式</small></div><i>›</i></button>
      <button onClick={onDownload}><span className="setting-icon pink">⇩</span><div><b>允许下载作品</b><small>{downloadAllowed ? "已开启" : "当前关闭"}</small></div><span className={`soft-toggle ${downloadAllowed ? "on" : ""}`}><i/></span></button>
      <button><span className="setting-icon green">♢</span><div><b>隐私与数据</b><small>不支持上传真人照片</small></div><i>›</i></button>
    </section>
  </>;
}
