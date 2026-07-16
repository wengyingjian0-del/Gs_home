"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type SavedCharacter = { id: string; name: string; appearance: Record<string, string> };
type Panel = { title: string; scene: string; action: string; emotion: string; background: string; dialogue: string; narration: string; imageUrl?: string; referenceKey?: string };

const genres = ["搞笑反转", "温暖友情", "奇妙冒险", "科学发现", "校园趣事", "梦幻魔法"];

export function FourComicStudio() {
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [genre, setGenre] = useState(genres[0]);
  const [idea, setIdea] = useState("");
  const [storyTitle, setStoryTitle] = useState("");
  const [panels, setPanels] = useState<Panel[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showBook, setShowBook] = useState(false);
  const [bookLayout, setBookLayout] = useState<"grid" | "vertical">("grid");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("manhua-characters") || "[]") as SavedCharacter[];
      setCharacters(saved);
      setCharacterId(localStorage.getItem("manhua-active-character") || saved[0]?.id || "");
    } catch { setCharacters([]); }
  }, []);

  const character = characters.find(item => item.id === characterId);

  async function planStory() {
    if (!character) return setError("请先回到角色页创建一个角色。");
    setBusy("AI正在构思四格故事……"); setError("");
    try {
      const response = await fetch("/api/four-comic/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character: character.appearance, genre, idea }) });
      const data = await response.json() as { storyTitle?: string; panels?: Panel[]; message?: string };
      if (!response.ok || !data.panels) throw new Error(data.message || "故事没有完整生成");
      setStoryTitle(data.storyTitle || "我的四格漫画"); setPanels(data.panels);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "故事策划失败"); }
    finally { setBusy(""); }
  }

  function updatePanel(index: number, key: "dialogue" | "narration", value: string) {
    setPanels(current => current.map((panel, panelIndex) => panelIndex === index ? { ...panel, [key]: value } : panel));
  }

  async function generateComic() {
    if (!character || panels.length !== 4) return;
    setBusy("正在生成第 1 格，共 4 格……"); setError(""); setShowBook(false);
    let referenceKey: string | undefined;
    const completed = [...panels];
    try {
      for (let index = 0; index < 4; index++) {
        setBusy(`正在生成第 ${index + 1} 格，共 4 格……`);
        const panel = completed[index];
        const description = `四格漫画《${storyTitle}》第${index + 1}格。${panel.title}。场景：${panel.scene}。动作：${panel.action}。表情：${panel.emotion}。背景：${panel.background}。画面中不要出现任何文字、气泡或水印。严格保持主角脸、发型、服装、配饰和画风与前格一致；前格只作为主角外观参考，不继承其中未被本格剧情明确要求的背景角色、拟人化装饰、漂浮物或偶发多余元素。`;
        const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character: character.appearance, scene: { place: panel.scene, action: panel.action, emotion: panel.emotion, extra: panel.background }, extraDescription: description, referenceKey, conversationContext: completed.slice(0, index + 1).map(item => `${item.scene}/${item.action}`).join(" → ") }) });
        const data = await response.json() as { imageUrl?: string; referenceKey?: string; message?: string };
        if (!response.ok || !data.imageUrl || !data.referenceKey) throw new Error(data.message || `第${index + 1}格生成失败`);
        completed[index] = { ...panel, imageUrl: data.imageUrl, referenceKey: data.referenceKey };
        referenceKey = data.referenceKey;
        setPanels([...completed]);
      }
      localStorage.setItem("manhua-four-comic-latest", JSON.stringify({ storyTitle, panels: completed, createdAt: new Date().toISOString() }));
      setShowBook(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "四格漫画生成失败"); }
    finally { setBusy(""); }
  }

  async function downloadComicBook() {
    if (!panels.every(panel => panel.imageUrl)) return;
    setBusy("正在合成漫画册……"); setError("");
    try {
      const margin = 48, gap = 26, titleHeight = 130;
      const cellWidth = 720, cellHeight = 960;
      const columns = bookLayout === "grid" ? 2 : 1;
      const rows = bookLayout === "grid" ? 2 : 4;
      const width = margin * 2 + columns * cellWidth + (columns - 1) * gap;
      const height = margin * 2 + titleHeight + rows * cellHeight + (rows - 1) * gap;
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器无法创建漫画画布");
      context.fillStyle = "#fffaf0"; context.fillRect(0, 0, width, height);
      context.fillStyle = "#3e3331"; context.font = "bold 54px sans-serif"; context.textAlign = "center"; context.fillText(storyTitle || "我的四格漫画", width / 2, 78);
      const wrap = (text: string, maxWidth: number) => {
        const lines: string[] = []; let line = "";
        for (const char of text) { const next = line + char; if (context.measureText(next).width > maxWidth && line) { lines.push(line); line = char; } else line = next; }
        if (line) lines.push(line); return lines.slice(0, 3);
      };
      for (let index = 0; index < 4; index++) {
        const panel = panels[index]; const col = bookLayout === "grid" ? index % 2 : 0; const row = bookLayout === "grid" ? Math.floor(index / 2) : index;
        const x = margin + col * (cellWidth + gap), y = margin + titleHeight + row * (cellHeight + gap);
        const response = await fetch(panel.imageUrl!); if (!response.ok) throw new Error(`第${index + 1}格图片读取失败`);
        const bitmap = await createImageBitmap(await response.blob());
        const scale = Math.max(cellWidth / bitmap.width, cellHeight / bitmap.height); const sourceWidth = cellWidth / scale, sourceHeight = cellHeight / scale;
        context.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, cellWidth, cellHeight); bitmap.close();
        context.strokeStyle = "#433836"; context.lineWidth = 10; context.strokeRect(x, y, cellWidth, cellHeight);
        context.fillStyle = "#ff7f82"; context.beginPath(); context.arc(x + 42, y + 42, 28, 0, Math.PI * 2); context.fill(); context.fillStyle = "white"; context.font = "bold 30px sans-serif"; context.fillText(String(index + 1), x + 42, y + 53);
        if (panel.narration) { context.font = "26px sans-serif"; const lines = wrap(panel.narration, cellWidth - 160); const boxHeight = 24 + lines.length * 34; context.fillStyle = "rgba(255,250,220,.94)"; context.fillRect(x + 90, y + 18, cellWidth - 110, boxHeight); context.fillStyle = "#403634"; context.textAlign = "left"; lines.forEach((line, lineIndex) => context.fillText(line, x + 105, y + 50 + lineIndex * 34)); }
        if (panel.dialogue) { context.font = "bold 28px sans-serif"; const lines = wrap(panel.dialogue, cellWidth - 100); const boxHeight = 30 + lines.length * 38; context.fillStyle = "rgba(255,255,255,.96)"; context.fillRect(x + 35, y + cellHeight - boxHeight - 28, cellWidth - 70, boxHeight); context.strokeStyle = "#4b403d"; context.lineWidth = 4; context.strokeRect(x + 35, y + cellHeight - boxHeight - 28, cellWidth - 70, boxHeight); context.fillStyle = "#302827"; context.textAlign = "left"; lines.forEach((line, lineIndex) => context.fillText(line, x + 55, y + cellHeight - boxHeight + 10 + lineIndex * 38)); }
        context.textAlign = "center";
      }
      const link = document.createElement("a"); link.download = `${storyTitle || "四格漫画"}.png`; link.href = canvas.toDataURL("image/png"); link.click();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "漫画册合成失败"); }
    finally { setBusy(""); }
  }

  return <main className="four-studio">
    <header className="four-header"><a href="/">‹ 返回</a><div><span>独立创作模式</span><h1>四格漫画工作室</h1></div></header>
    <section className="four-setup">
      <label>选择主角<select value={characterId} onChange={event => setCharacterId(event.target.value)}><option value="">请选择角色</option>{characters.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <div><b>故事类型</b><div className="genre-grid">{genres.map(item => <button className={genre === item ? "selected" : ""} onClick={() => setGenre(item)} key={item}>{item}</button>)}</div></div>
      <label>故事灵感（可以留空）<textarea maxLength={2000} value={idea} onChange={event => setIdea(event.target.value)} placeholder="可以粘贴完整的故事、分镜、人物对白和背景要求……" /><small className="idea-count">{idea.length} / 2000 字</small></label>
      <button className="four-primary" disabled={!character || !!busy} onClick={planStory}>AI帮我写四格故事</button>
    </section>
    {busy && <div className="four-status"><i />{busy}</div>}{error && <div className="friendly-error"><b>暂时没有完成</b><span>{error}</span></div>}
    {panels.length === 4 && <section className="four-plan"><div className="four-plan-title"><div><span>AI分镜脚本</span><h2>{storyTitle}</h2></div><button onClick={planStory} disabled={!!busy}>换一个故事</button></div>
      <div className="four-grid">{panels.map((panel, index) => <article key={index}><div className="panel-number">{index + 1}</div>{panel.imageUrl ? <div className="panel-image"><Image src={panel.imageUrl} alt={`第${index + 1}格`} fill unoptimized sizes="500px" /><div className="comic-text">{panel.narration && <small>{panel.narration}</small>}{panel.dialogue && <p>{panel.dialogue}</p>}</div></div> : <div className="panel-placeholder"><b>{panel.title}</b><p>{panel.scene}</p><p>{panel.action}</p><small>{panel.background}</small></div>}<label>台词<input maxLength={60} value={panel.dialogue} onChange={event => updatePanel(index, "dialogue", event.target.value)} /></label><label>旁白<input maxLength={60} value={panel.narration} onChange={event => updatePanel(index, "narration", event.target.value)} /></label></article>)}</div>
      <button className="four-primary" disabled={!!busy} onClick={generateComic}>{panels.every(panel => panel.imageUrl) ? "重新生成四格图片" : "确认脚本并生成四格漫画"}</button>
      {panels.every(panel => panel.imageUrl) && <button className="open-book" onClick={() => setShowBook(true)}>▦ 打开完整漫画册</button>}
    </section>}
    {showBook && panels.every(panel => panel.imageUrl) && <section className="comic-book-section"><div className="book-toolbar"><div><span>漫画册成品</span><h2>{storyTitle}</h2></div><div><button className={bookLayout === "grid" ? "active" : ""} onClick={() => setBookLayout("grid")}>2×2 四格</button><button className={bookLayout === "vertical" ? "active" : ""} onClick={() => setBookLayout("vertical")}>竖向四格</button></div></div><div className={`comic-book ${bookLayout}`}><h1>{storyTitle}</h1>{panels.map((panel, index) => <article key={index}><div className="book-panel-number">{index + 1}</div><Image src={panel.imageUrl!} alt={`漫画第${index + 1}格`} fill unoptimized sizes="700px" />{panel.narration && <small>{panel.narration}</small>}{panel.dialogue && <p>{panel.dialogue}</p>}</article>)}</div><button className="four-primary download-book" disabled={!!busy} onClick={downloadComicBook}>下载完整四格漫画 PNG</button></section>}
  </main>;
}
