/**
 * AI 一键配图：官方预设模板与自定义模板解析。
 *
 * 模板 = 带占位符的提示词正文。数据占位符（{{ARTICLE_TITLE}} 等）生成时由前端替换，
 * 其余 {{...}} 创意占位符由后端文本模型填充（见 cover-placeholders.ts）。
 *
 * - 官方预设：本文件硬编码，随代码发版；id 必须稳定（会存入 localStorage 作默认选中）。
 * - 自定义模板：settings key `ai_cover_templates`（JSON 数组），管理后台维护。
 *
 * 想新增官方预设：往 OFFICIAL_COVER_TEMPLATES 追加一项即可，前端弹窗与设置页自动展示。
 */

import { buildCoverSourcePrompt, fillDataPlaceholders, type CoverPromptInput } from "./cover-placeholders";

export interface CoverTemplate {
  id: string;
  name: string;
  description: string;
  template: string;
  /** true = 官方预设（随代码内置，不可编辑删除） */
  builtIn: boolean;
}

/** 自定义模板在 settings 中的存储结构 */
export interface CustomCoverTemplate {
  id: string;
  name: string;
  description?: string;
  template: string;
  enabled: boolean;
  /** 设为默认：弹窗打开时默认选中（最多一个，序列化时后写者胜） */
  is_default?: boolean;
}

const PRESET_LOGO_KEYWORD = `根据以下文章标题和内容概要，生成一张现代科技博客文章封面。

文章标题：
{{ARTICLE_TITLE}}

文章概要：
{{ARTICLE_OUTLINE}}

请根据文章内容自动提炼最核心的 1～3 个关键词，并自动选择最具代表性的 Logo / 图标 / 视觉主体。

【核心构图】
采用「大字背景 + 中央主体遮挡」构图：

* 背景使用简洁高级的柔和渐变色
* 将提炼出的核心关键词作为画面中的超大号中文文字，横向铺在背景中央
* 文字要足够大，并成为背景的主要视觉元素
* 在文字正中央放置文章主题对应的 Logo、3D 图标或核心视觉主体
* Logo / 主体必须位于文字前方，明显遮挡文字的一部分
* 形成"文字在后、Logo 在前"的明显空间层次
* 文字不需要完整显示，被主体自然遮挡
* 画面保持极简，不添加多余 UI、段落、卡片或装饰元素

【占位逻辑】
核心文字：
{{KEYWORDS}}

中央 Logo / 主体：
{{LOGO_OR_SUBJECT}}

以上两个元素不要固定内容，必须根据文章标题和概要自动选择。

【风格】
现代科技博客 / AI 产品宣传视觉，简洁、精致、轻 3D、柔和渐变、玻璃质感、细腻阴影、高级留白。

最终重点：
**超大关键词作为背景，中央 Logo / 视觉主体压在关键词前面并遮挡文字。**`;

const PRESET_POSTER_INFOGRAPHIC = `一张横版宣传海报信息图，主题是"{{ARTICLE_TITLE}}"，整体采用明亮的科技蓝色调，卡通插画风格，背景是浅蓝色渐变带有云朵和星光点缀。

【顶部区域】
左上角有一个黄色爆炸形标签写着"{{BADGE_MAIN}}"和"{{BADGE_SUB}}!"。中间是主标题"{{ARTICLE_TITLE}}"，其中"{{TITLE_HIGHLIGHT}}"这几个字用橙黄色高亮显示，标题左侧有一个蓝黄配色的圆形{{LOGO_ICON}}logo。标题下方是副标题"{{SUBTITLE}}"。右上角有一个蓝色{{CORNER_ICON}}图标配文字"{{CORNER_MAIN}} {{CORNER_SUB}}!"。

【数据亮点横条】
标题下方是一排四个白色圆角卡片：
1. {{CARD1_ICON}}图标 + "{{CARD1_NUMBER}}" 橙色大字 + "{{CARD1_TEXT}}"
2. {{CARD2_ICON}}图标 + "{{CARD2_NUMBER}}" 橙色大字 + "{{CARD2_TEXT}}"
3. {{CARD3_ICON}}图标 + "{{CARD3_NUMBER}}" 橙色大字 + "{{CARD3_TEXT}}"
4. {{CARD4_ICON}}图标 + "{{CARD4_NUMBER}}" 橙色大字 + "{{CARD4_TEXT}}"

【中间主体区域分为三栏】

左栏 - 蓝色标题框"{{LEFT_TITLE}}"，下方四个白色卡片呈2x2排列（如果只有3项则纵向排列）：
- {{LEFT1_ICON}}图标 + "{{LEFT1_TITLE}}"，小字"{{LEFT1_SUB}}"
- {{LEFT2_ICON}}图标 + "{{LEFT2_TITLE}}"，小字"{{LEFT2_SUB}}"
- {{LEFT3_ICON}}图标 + "{{LEFT3_TITLE}}"，小字"{{LEFT3_SUB}}"
- {{LEFT4_ICON}}图标 + "{{LEFT4_TITLE}}"，小字"{{LEFT4_SUB}}"

中栏 - 一个开心的卡通{{CHARACTER_IDENTITY}}，{{CHARACTER_APPEARANCE}}，左手高举{{LEFT_HAND_ITEM}}，右手拿着{{RIGHT_HAND_ITEM}}。旁边站着一个可爱的白色AI机器人，圆脑袋，蓝色眼睛，胸前写"{{ROBOT_TEXT}}"，竖起大拇指。周围漂浮着彩色标签气泡："{{BUBBLE1}}"(蓝色)、"{{BUBBLE2}}"(绿色)、"{{BUBBLE3}}"(紫色)，还有蓝色箭头和星星装饰。

右栏 - 蓝色标题框"{{RIGHT_TITLE}}"，下方若干白色卡片纵向排列：
- {{RIGHT1_ICON}}图标 + "{{RIGHT1_TITLE}}"，小字"{{RIGHT1_SUB}}"
- {{RIGHT2_ICON}}图标 + "{{RIGHT2_TITLE}}"，小字"{{RIGHT2_SUB}}"
- {{RIGHT3_ICON}}图标 + "{{RIGHT3_TITLE}}"，小字"{{RIGHT3_SUB}}"

【下方补充区域】
左侧数个带蓝色圆形勾选标记的要点（分列排布）：
- "{{POINT1}}"
- "{{POINT2}}"
- "{{POINT3}}"

右侧一个金色皇冠徽章写着"{{CROWN_TEXT}}"，旁边 "{{RIGHT_SUMMARY}}"。

【底部横幅】
深蓝色底条，左侧{{FOOTER_ICON}}图标，文字"{{FOOTER_MAIN}}"（需要高亮的词用橙黄色），右侧盾牌图标 + "{{FOOTER_SUB}}"。

整体风格：扁平化卡通插画，色彩鲜艳明快，以蓝色为主色调搭配橙黄色点缀，充满科技感和活力，适合{{POSTER_SCENE}}类宣传物料。所有中文文字清晰可读，排版整齐美观，无乱码。`;

const PRESET_MINIMAL_TEXT = `一张现代简约的博客文章封面图，横版 16:9。

画面中央偏左放置文章主标题"{{ARTICLE_TITLE}}"，使用大号无衬线粗体，深色文字；标题下方一行浅灰色小字副文案："{{ARTICLE_CATEGORY}}"。

背景为大面积柔和留白（米白或浅灰渐变），右下角放置一个与文章主题相关的小型几何装饰图形，低饱和度，不抢主体。

整体极简、高级留白，无其他 UI 元素、无卡片、无段落文字，所有文字清晰可读无乱码。`;

/** 官方预设（内置，随代码发版） */
export const OFFICIAL_COVER_TEMPLATES: CoverTemplate[] = [
  {
    id: "preset_logo_keyword",
    name: "关键词大字 + Logo 遮挡",
    description: "超大关键词作背景，中央 3D Logo/主体遮挡文字，现代科技风，极简高级",
    template: PRESET_LOGO_KEYWORD,
    builtIn: true,
  },
  {
    id: "preset_poster_infographic",
    name: "科技蓝海报信息图",
    description: "明亮科技蓝卡通海报：标题横条、数据卡片、三栏主体、底部横幅，信息量饱满",
    template: PRESET_POSTER_INFOGRAPHIC,
    builtIn: true,
  },
  {
    id: "preset_minimal_text",
    name: "极简文字封面",
    description: "大标题 + 留白 + 小装饰，纯数据字段直接生成，不消耗文本模型",
    template: PRESET_MINIMAL_TEXT,
    builtIn: true,
  },
];

const CUSTOM_TEMPLATES_STORAGE_KEY = "ai-cover-last-template-id";

/** 解析 settings 中 ai_cover_templates 的 JSON 字符串；非法输入返回空数组 */
export function parseCustomTemplates(raw: string | undefined | null): CustomCoverTemplate[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  try {
    const arr = JSON.parse(trimmed) as CustomCoverTemplate[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(p => p && typeof p.id === "string" && typeof p.template === "string")
      .map(p => ({
        id: p.id,
        name: p.name ?? "",
        description: p.description ?? "",
        template: p.template,
        enabled: p.enabled !== false,
        is_default: !!p.is_default,
      }));
  } catch {
    return [];
  }
}

/** 序列化自定义模板为 settings 存储字符串；is_default 仅保留一个 */
export function serializeCustomTemplates(templates: CustomCoverTemplate[]): string {
  let defaultSeen = false;
  const out = templates.map(t => {
    const isDefault = !!t.is_default && !defaultSeen && t.enabled;
    if (isDefault) defaultSeen = true;
    return {
      id: t.id,
      name: t.name?.trim() ?? "",
      description: t.description?.trim() ?? "",
      template: t.template ?? "",
      enabled: t.enabled !== false,
      is_default: isDefault,
    };
  });
  return JSON.stringify(out);
}

export function genTemplateId(): string {
  return `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 上次使用的模板 id（localStorage），弹窗默认选中用 */
export function getLastUsedTemplateId(): string | null {
  try {
    return localStorage.getItem(CUSTOM_TEMPLATES_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastUsedTemplateId(id: string): void {
  try {
    localStorage.setItem(CUSTOM_TEMPLATES_STORAGE_KEY, id);
  } catch {
    // 隐私模式等场景下静默失败，不影响主流程
  }
}

/**
 * 按弹窗选择解析出实际模板：
 * - 官方预设 id → 内置表
 * - 自定义 id → 传入的自定义列表
 * - 找不到（已被删除等）→ 回退第一个官方预设
 */
export function resolveTemplate(templateId: string, customTemplates: CustomCoverTemplate[]): CoverTemplate {
  const custom = customTemplates.find(t => t.id === templateId && t.enabled);
  if (custom) {
    return { id: custom.id, name: custom.name, description: custom.description ?? "", template: custom.template, builtIn: false };
  }
  const official = OFFICIAL_COVER_TEMPLATES.find(t => t.id === templateId);
  return official ?? OFFICIAL_COVER_TEMPLATES[0];
}

/**
 * 由模板 + 文章信息生成最终源提示词：
 * 数据占位符确定性替换，再追加【文章信息】块供后端 LLM 创意填充参考。
 */
export function buildPromptFromTemplate(template: CoverTemplate, input: CoverPromptInput): string {
  const filled = fillDataPlaceholders(template.template, input);
  return buildCoverSourcePrompt(filled, input);
}
