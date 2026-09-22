/**
 * AI 一键配图：占位符注册表与数据填充。
 *
 * 模板占位符分两类：
 * - 数据占位符：固定字段，生成时由前端从文章表单态确定性替换，不消耗 LLM；
 * - 创意占位符：任意其他 {{KEY}}，原样保留在源提示词中，
 *   由后端文本模型参考文末【文章信息】填充（纯数据模板不含 {{ }}，后端自动跳过 LLM）。
 *
 * 占位符命名统一大写下划线风格（如 {{ARTICLE_TITLE}}），新增数据字段时
 * 同步维护 DATA_PLACEHOLDERS 与 CoverPromptInput。
 */

/** 数据占位符定义（前端可确定性替换的固定字段） */
export interface DataPlaceholder {
  key: string;
  label: string;
  description: string;
}

export const DATA_PLACEHOLDERS: DataPlaceholder[] = [
  { key: "ARTICLE_TITLE", label: "文章标题", description: "文章当前标题" },
  { key: "ARTICLE_OUTLINE", label: "文章概要", description: "文章摘要；为空时生成流程会先自动生成摘要" },
  { key: "ARTICLE_CATEGORY", label: "文章分类", description: "文章所属分类名" },
  { key: "ARTICLE_TAGS", label: "文章标签", description: "所有标签名，顿号连接" },
];

/** 常用创意占位符（后端 LLM 依文章信息填充，可自由扩展任意 {{KEY}}） */
export const CREATIVE_PLACEHOLDER_SUGGESTIONS: DataPlaceholder[] = [
  { key: "KEYWORDS", label: "核心关键词", description: "由 LLM 从标题/概要提炼 1~3 个核心关键词" },
  { key: "KEYWORD", label: "背景关键词", description: "由 LLM 提炼的 1 个背景超大文字关键词" },
  { key: "LOGO_OR_SUBJECT", label: "中央 Logo/主体", description: "由 LLM 依文章主题选择代表性图标或视觉主体" },
  { key: "MAIN_SUBJECT", label: "中央主体描述", description: "由 LLM 设计的中央 3D 视觉主体完整描述" },
];

/** buildCoverSourcePrompt 的入参：文章表单态元信息 */
export interface CoverPromptInput {
  title?: string;
  category?: string;
  tags?: string[];
  summary?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把单个 {{KEY}} 占位符替换为 value；value 为空时保留占位符原文交由 LLM 兜底 */
function replacePlaceholder(template: string, key: string, value: string): string {
  if (!value) return template;
  return template.replace(new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, "g"), value);
}

/**
 * 替换模板中的全部数据占位符，创意占位符原样保留。
 */
export function fillDataPlaceholders(template: string, input: CoverPromptInput): string {
  const title = (input.title ?? "").trim();
  const category = (input.category ?? "").trim();
  const tags = (input.tags ?? []).map(t => t.trim()).filter(Boolean);
  const summary = (input.summary ?? "").trim();

  let out = template;
  out = replacePlaceholder(out, "ARTICLE_TITLE", title);
  out = replacePlaceholder(out, "ARTICLE_OUTLINE", summary);
  out = replacePlaceholder(out, "ARTICLE_CATEGORY", category);
  out = replacePlaceholder(out, "ARTICLE_TAGS", tags.join("、"));
  return out;
}

/** 检测是否仍含 {{...}} 占位符（含即需后端 LLM 创意填充） */
export function hasCreativePlaceholders(prompt: string): boolean {
  return /\{\{[^}]+\}\}/.test(prompt);
}

/**
 * 把填充后的模板拼成源提示词：模板正文 + 【文章信息】块。
 * 文章信息块供后端 LLM 填充创意占位符时参考；纯数据模板会因不含 {{ }} 被后端跳过 LLM。
 */
export function buildCoverSourcePrompt(filledTemplate: string, input: CoverPromptInput): string {
  const title = (input.title ?? "").trim();
  const category = (input.category ?? "").trim();
  const tags = (input.tags ?? []).map(t => t.trim()).filter(Boolean);
  const summary = (input.summary ?? "").trim();

  const infoLines: string[] = [];
  if (title) infoLines.push(`标题：${title}`);
  if (category) infoLines.push(`分类：${category}`);
  if (tags.length > 0) infoLines.push(`标签：${tags.join("、")}`);
  if (summary) infoLines.push(`摘要：${summary}`);

  if (infoLines.length === 0) return filledTemplate;
  return [filledTemplate, "", "【文章信息】", ...infoLines].join("\n");
}
