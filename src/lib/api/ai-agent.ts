/**
 * 博客 AI Agent 助手 API
 * 调用后端 /api/public/ai-agent/*
 */
import { apiClient } from "./client";

export interface AIAgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIAgentPageContext {
  path?: string;
  title?: string;
  description?: string;
}

export interface AIAgentAction {
  type: string; // navigate
  path: string;
  label?: string;
}

export interface AIAgentChatRequest {
  messages: AIAgentMessage[];
  page?: AIAgentPageContext;
}

export interface AIAgentChatResponse {
  reply: string;
  actions?: AIAgentAction[];
}

export interface AIAgentConfig {
  enabled: boolean;
  name: string;
  description?: string;
  quick_prompts?: string[];
}

/** 对话超时：Agent 工具循环可能多次调用模型，覆盖默认 30s */
const AI_CHAT_TIMEOUT = 120000; // 2 分钟

export const aiAgentApi = {
  /** 获取 AI Agent 配置（是否启用、快捷提示） */
  getConfig() {
    return apiClient.get<AIAgentConfig>("/api/public/ai-agent/config");
  },

  /** 发起对话（含工具调用） */
  chat(payload: AIAgentChatRequest) {
    return apiClient.post<AIAgentChatResponse>("/api/public/ai-agent/chat", payload, {
      timeout: AI_CHAT_TIMEOUT,
    });
  },
};