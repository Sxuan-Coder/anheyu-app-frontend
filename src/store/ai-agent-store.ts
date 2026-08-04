/**
 * AI Agent 助手状态管理
 * 持久化对话记录，跨页面保持上下文（参考 zhheo 的「页面跳转后还能保持上下文继续聊」）
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AIAgentAction, AIAgentMessage } from "@/lib/api/ai-agent";

/** 带可执行动作的对话消息 */
export interface AIAssistantMessage extends AIAgentMessage {
  actions?: AIAgentAction[];
}

interface AIAgentState {
  /** 对话面板是否打开 */
  isOpen: boolean;
  /** 是否窗口化（独立窗口模式） */
  isWindowed: boolean;
  /** 对话记录 */
  messages: AIAssistantMessage[];
  /** 是否正在等待 AI 回复 */
  isStreaming: boolean;
  /** 快捷提示词 */
  quickPrompts: string[];

  toggleOpen: (value?: boolean) => void;
  toggleWindowed: (value?: boolean) => void;
  clearMessages: () => void;
  setMessages: (messages: AIAssistantMessage[]) => void;
  appendMessage: (message: AIAssistantMessage) => void;
  updateLastMessage: (content: string, actions?: AIAgentAction[]) => void;
  setStreaming: (value: boolean) => void;
  setQuickPrompts: (prompts: string[]) => void;
}

const DEFAULT_QUICK_PROMPTS = [
  "🔥 有哪些热门文章推荐",
  "🎨 帮我搜索关于 AI 的文章",
  "🎵 介绍一下这个博客",
  "📮 怎么订阅博客更新？",
  "🔗 推荐几个友情链接",
  "👋 帮我去看看关于页面",
];

export const useAIAgentStore = create<AIAgentState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      isWindowed: false,
      messages: [],
      isStreaming: false,
      quickPrompts: DEFAULT_QUICK_PROMPTS,

      toggleOpen: (value?: boolean) =>
        set({ isOpen: typeof value === "boolean" ? value : !get().isOpen }),

      toggleWindowed: (value?: boolean) =>
        set({ isWindowed: typeof value === "boolean" ? value : !get().isWindowed }),

      clearMessages: () => set({ messages: [] }),

      setMessages: messages => set({ messages }),

      appendMessage: message => set(state => ({ messages: [...state.messages, message] })),

      updateLastMessage: (content, actions) =>
        set(state => {
          const messages = [...state.messages];
          if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
            messages[messages.length - 1] = { ...messages[messages.length - 1], content, actions };
          } else {
            messages.push({ role: "assistant", content, actions });
          }
          return { messages };
        }),

      setStreaming: value => set({ isStreaming: value }),

      setQuickPrompts: prompts => set({ quickPrompts: prompts.length > 0 ? prompts : DEFAULT_QUICK_PROMPTS }),
    }),
    {
      name: "anheyu-ai-agent-store",
      partialize: state => ({
        isWindowed: state.isWindowed,
        messages: state.messages,
        quickPrompts: state.quickPrompts,
      }),
    }
  )
);