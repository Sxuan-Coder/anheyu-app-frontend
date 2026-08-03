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

/** 配图两步生成（文本模型填模板 + 图像模型出图）耗时较长，覆盖默认 30s 超时 */
const AI_COVER_TIMEOUT = 300000; // 5 分钟（后端 chat 60s + image 180s 上限，再留余量）

export const articleAiApi = {
  /** 生成 ≤300 字摘要 */
  summary(payload: ArticleAISummaryRequest) {
    return apiClient.post<ArticleAISummaryResponse>("/api/articles/ai-summary", payload);
  },
  /** 生成封面图并入库，返回直链 URL */
  cover(payload: ArticleAICoverRequest) {
    return apiClient.post<ArticleAICoverResponse>("/api/articles/ai-cover", payload, {
      timeout: AI_COVER_TIMEOUT,
    });
  },
};
