/**
 * 文章 AI 辅助 API：AI 摘要 + 一键 AI 配图
 * 调用后端 /api/articles/ai-summary 与 /api/articles/ai-cover
 */
import { apiClient } from "./client";

export interface ArticleAISummaryRequest {
  title: string;
  content: string;
  /** 可选：指定使用哪个 ai_profiles 配置 ID */
  profile_id?: string;
}

export interface ArticleAICoverRequest {
  /** 前端拼接好的「海报模板 + 文章信息」源提示词 */
  prompt: string;
  /** 可选：指定使用哪个 ai_profiles 配置 ID */
  profile_id?: string;
}

export interface ArticleAISummaryResponse {
  summary: string;
}

export interface ArticleAICoverResponse {
  url: string;
  file_id: string;
}

export const articleAiApi = {
  /** 生成 ≤300 字摘要 */
  summary(payload: ArticleAISummaryRequest) {
    return apiClient.post<ArticleAISummaryResponse>("/api/articles/ai-summary", payload);
  },
  /** 生成封面图并入库，返回直链 URL */
  cover(payload: ArticleAICoverRequest) {
    return apiClient.post<ArticleAICoverResponse>("/api/articles/ai-cover", payload);
  },
};
