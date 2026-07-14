/**
 * 🌿 漫小星 - 上下文创作界面
 * 
 * 特点：
 * - 对话式交互
 * - 基于上次创作智能建议
 * - 自然语言输入
 * - 温暖的宫崎骏风格
 */

import React, { useState, useEffect } from 'react';
import { CreationContextManager, generateSuggestions, parseUserIntent } from './context-mode';
import type { CreationContext, Suggestion } from './context-mode';

export function ContextCreationView() {
  const [context, setContext] = useState<CreationContext | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  
  const contextManager = new CreationContextManager();
  
  useEffect(() => {
    // 加载上下文
    const savedContext = contextManager.getContext();
    setContext(savedContext);
    
    // 生成建议
    const newSuggestions = generateSuggestions(savedContext);
    setSuggestions(newSuggestions);
  }, []);
  
  // 处理用户输入
  const handleSubmit = () => {
    if (!userInput.trim()) return;
    
    // 解析用户意图
    const intent = parseUserIntent(userInput);
    
    // 添加对话记录
    contextManager.addDialogue({
      role: 'user',
      content: userInput,
      timestamp: new Date()
    });
    
    // 清空输入
    setUserInput('');
    
    // 显示"思考中"状态
    setIsTyping(true);
    
    // 模拟AI响应
    setTimeout(() => {
      setIsTyping(false);
      
      // 根据意图生成响应
      const response = generateResponse(intent, context);
      
      contextManager.addDialogue({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      });
      
      // 更新上下文
      setContext(contextManager.getContext());
    }, 1500);
  };
  
  // 处理建议点击
  const handleSuggestionClick = (suggestion: Suggestion) => {
    setUserInput(suggestion.text);
  };
  
  return (
    <div className="dialogue-container">
      {/* 上下文提示 */}
      {context?.lastArtwork && (
        <div className="context-hint">
          <div className="hint-icon">💭</div>
          <div className="hint-content">
            <h2>上次你画了{context.lastArtwork.character.name}</h2>
            <p>在{context.lastArtwork.scene.location}，{context.lastArtwork.scene.mood}的样子</p>
          </div>
        </div>
      )}
      
      {/* 对话区域 */}
      <div className="dialogue-bubble">
        <div className="dialogue-avatar">🌟</div>
        <div className="dialogue-content">
          <p className="dialogue-text">
            {context?.lastArtwork 
              ? '今天想继续小星的故事吗？或者尝试一些新的创作？'
              : '你好呀！我是漫小星，让我来陪你慢慢描绘属于你的漫画世界吧~'
            }
          </p>
        </div>
      </div>
      
      {/* 思考中状态 */}
      {isTyping && (
        <div className="dialogue-bubble">
          <div className="dialogue-avatar">🌟</div>
          <div className="dialogue-content">
            <p className="dialogue-text">
              正在思考... 
              <span className="typing-indicator">💭</span>
            </p>
          </div>
        </div>
      )}
      
      {/* 建议卡片 */}
      <div className="suggestions">
        {suggestions.map(suggestion => (
          <button
            key={suggestion.id}
            className="suggestion-chip"
            onClick={() => handleSuggestionClick(suggestion)}
          >
            <span className="suggestion-icon">{suggestion.icon}</span>
            <span>{suggestion.text}</span>
          </button>
        ))}
      </div>
      
      {/* 输入区域 */}
      <div className="input-container">
        <textarea
          className="text-input"
          placeholder="用自然的方式告诉我你的想法，比如：让她在森林里发现一棵会发光的大树..."
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          rows={3}
        />
        
        <div className="input-hint">
          <span className="hint-text">按 Enter 发送，或点击语音按钮说话</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="voice-btn">
              <span>🎤</span>
              <span>语音</span>
            </button>
            <button 
              className="voice-btn"
              onClick={handleSubmit}
              style={{ background: '#4A7C59' }}
            >
              <span>✨</span>
              <span>发送</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 生成响应
function generateResponse(intent: any, context: CreationContext | null): string {
  if (intent.type === 'modify') {
    if (intent.modifyTarget === 'emotion') {
      return `好的！我来把小星的心情改成${intent.modifyValue}的样子~ 这样画面会更生动呢！`;
    }
    if (intent.modifyTarget === 'action') {
      return `让小星${intent.modifyValue}吧！这个动作会让画面更有动感~`;
    }
    if (intent.modifyTarget === 'background') {
      return `${intent.modifyValue}是个很棒的场景选择！我会让画面更有层次感~`;
    }
    if (intent.modifyTarget === 'style') {
      return `好的！用${intent.modifyValue}风格来画，会让整个画面更温馨~`;
    }
  }
  
  if (intent.type === 'continue' && context?.lastArtwork) {
    return `继续${context.lastArtwork.character.name}的故事吧！让我来构思一下接下来的场景~`;
  }
  
  return `我理解你的想法了！${intent.description}，让我来慢慢描绘这个画面~`;
}