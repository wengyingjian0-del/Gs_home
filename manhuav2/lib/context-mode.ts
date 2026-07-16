/**
 * 🌿 漫小星 - 上下文创作模式
 * 
 * 核心理念：
 * - 基于上次创作继续
 * - 自然语言输入为主
 * - 记忆用户偏好
 * - 提供智能建议
 */

import React, { useState, useEffect } from 'react';

// ========== 类型定义 ==========

interface CreationContext {
  // 最近创作
  lastArtwork?: {
    id: string;
    character: {
      name: string;
      style: string;
      emoji: string;
    };
    scene: {
      location: string;
      mood: string;
    };
    thumbnail: string;
    createdAt: Date;
  };
  
  // 用户偏好
  preferences: {
    favoriteStyles: string[];
    commonScenes: string[];
    frequentlyUsed: string[];
  };
  
  // 对话历史
  dialogueHistory: DialogueMessage[];
}

interface DialogueMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Suggestion {
  id: string;
  type: 'continue' | 'modify' | 'new';
  icon: string;
  text: string;
  description: string;
}

// ========== 上下文管理 ==========

class CreationContextManager {
  private storageKey = 'manxiaoxing-context';
  
  // 获取上下文
  getContext(): CreationContext {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load context:', error);
    }
    
    // 返回默认上下文
    return {
      preferences: {
        favoriteStyles: [],
        commonScenes: [],
        frequentlyUsed: []
      },
      dialogueHistory: []
    };
  }
  
  // 保存上下文
  saveContext(context: CreationContext): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(context));
    } catch (error) {
      console.error('Failed to save context:', error);
    }
  }
  
  // 更新最近创作
  updateLastArtwork(artwork: CreationContext['lastArtwork']): void {
    const context = this.getContext();
    context.lastArtwork = artwork;
    this.saveContext(context);
  }
  
  // 添加对话记录
  addDialogue(message: DialogueMessage): void {
    const context = this.getContext();
    context.dialogueHistory.push(message);
    
    // 保持最近20条对话
    if (context.dialogueHistory.length > 20) {
      context.dialogueHistory = context.dialogueHistory.slice(-20);
    }
    
    this.saveContext(context);
  }
  
  // 学习用户偏好
  learnPreference(type: 'style' | 'scene', value: string): void {
    const context = this.getContext();
    
    if (type === 'style') {
      const styles = context.preferences.favoriteStyles;
      const index = styles.indexOf(value);
      if (index === -1) {
        styles.push(value);
      } else {
        styles[index] = value; // 移到后面表示更常使用
      }
    } else if (type === 'scene') {
      const scenes = context.preferences.commonScenes;
      const index = scenes.indexOf(value);
      if (index === -1) {
        scenes.push(value);
      }
    }
    
    this.saveContext(context);
  }
}

// ========== 智能建议系统 ==========

function generateSuggestions(context: CreationContext): Suggestion[] {
  const suggestions: Suggestion[] = [];
  
  // 基于上次创作
  if (context.lastArtwork) {
    suggestions.push({
      id: 'continue-last',
      type: 'continue',
      icon: '🌲',
      text: `继续${context.lastArtwork.character.name}的故事`,
      description: `上次在${context.lastArtwork.scene.location}`
    });
    
    suggestions.push({
      id: 'modify-emotion',
      type: 'modify',
      icon: '😊',
      text: '换个心情试试',
      description: '保持角色和场景，改变情绪'
    });
    
    suggestions.push({
      id: 'modify-action',
      type: 'modify',
      icon: '🏃',
      text: '换个动作',
      description: '让角色做点不一样的事'
    });
  }
  
  // 基于偏好
  if (context.preferences.favoriteStyles.length > 0) {
    const favoriteStyle = context.preferences.favoriteStyles[context.preferences.favoriteStyles.length - 1];
    suggestions.push({
      id: 'use-style',
      type: 'new',
      icon: '🎨',
      text: `用${favoriteStyle}风格`,
      description: '你最喜欢的创作风格'
    });
  }
  
  // 默认建议
  if (suggestions.length === 0) {
    suggestions.push({
      id: 'new-start',
      type: 'new',
      icon: '🌟',
      text: '开始新的创作',
      description: '选择一个角色开始你的故事'
    });
  }
  
  return suggestions.slice(0, 4); // 最多4个建议
}

// ========== 自然语言理解 ==========

function parseUserIntent(input: string): {
  type: 'create_new' | 'modify' | 'continue';
  modifyTarget?: 'emotion' | 'action' | 'background' | 'style';
  modifyValue?: string;
  description?: string;
} {
  // 修改意图检测
  if (input.includes('换') || input.includes('改') || input.includes('变')) {
    if (input.includes('表情') || input.includes('心情') || input.includes('情绪')) {
      return {
        type: 'modify',
        modifyTarget: 'emotion',
        modifyValue: extractEmotion(input),
        description: input
      };
    }
    
    if (input.includes('动作') || input.includes('姿势')) {
      return {
        type: 'modify',
        modifyTarget: 'action',
        modifyValue: extractAction(input),
        description: input
      };
    }
    
    if (input.includes('背景') || input.includes('场景') || input.includes('地方')) {
      return {
        type: 'modify',
        modifyTarget: 'background',
        modifyValue: extractBackground(input),
        description: input
      };
    }
    
    if (input.includes('风格') || input.includes('画风')) {
      return {
        type: 'modify',
        modifyTarget: 'style',
        modifyValue: extractStyle(input),
        description: input
      };
    }
  }
  
  // 默认为创建新内容
  return {
    type: 'create_new',
    description: input
  };
}

function extractEmotion(text: string): string {
  const emotions = ['开心', '难过', '好奇', '兴奋', '平静', '专注', '调皮', '害羞'];
  for (const emotion of emotions) {
    if (text.includes(emotion)) {
      return emotion;
    }
  }
  return '开心'; // 默认
}

function extractAction(text: string): string {
  const actions = ['站着', '坐着', '跑', '跳', '飞', '躺', '走'];
  for (const action of actions) {
    if (text.includes(action)) {
      return action;
    }
  }
  return '站着'; // 默认
}

function extractBackground(text: string): string {
  const backgrounds = ['森林', '海边', '天空', '城市', '花园', '山', '河边'];
  for (const bg of backgrounds) {
    if (text.includes(bg)) {
      return bg;
    }
  }
  return '森林'; // 默认
}

function extractStyle(text: string): string {
  const styles = ['温暖绘本', '清新国漫', '日系动漫', '欧美卡通'];
  for (const style of styles) {
    if (text.includes(style)) {
      return style;
    }
  }
  return '温暖绘本'; // 默认
}

// ========== 导出 ==========

export {
  CreationContextManager,
  generateSuggestions,
  parseUserIntent
};

export type { CreationContext, DialogueMessage, Suggestion };