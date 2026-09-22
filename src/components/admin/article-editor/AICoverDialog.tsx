"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Textarea, addToast } from "@heroui/react";
import { Loader2, Sparkles, Wand2, Eye, EyeOff } from "lucide-react";
import { AdminDialog } from "@/components/admin/AdminDialog";
import { settingsApi } from "@/lib/api/settings";
import { articleAiApi } from "@/lib/api/article-ai";
import { getErrorMessage } from "@/lib/api/client";
import { KEY_AI_COVER_TEMPLATES } from "@/lib/settings/setting-keys";
import {
  OFFICIAL_COVER_TEMPLATES,
  parseCustomTemplates,
  resolveTemplate,
  buildPromptFromTemplate,
  getLastUsedTemplateId,
  setLastUsedTemplateId,
  type CustomCoverTemplate,
} from "@/constants/cover-templates";
import { fillDataPlaceholders, hasCreativePlaceholders, type CoverPromptInput } from "@/constants/cover-placeholders";

/** 临时自定义模板的选择 id（不持久化） */
const AD_HOC_TEMPLATE_ID = "__adhoc__";

interface AICoverDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** 生成成功后回调（封面图 URL） */
  onGenerated: (url: string) => void;
  /** 文章当前元信息（标题/分类/标签/摘要，表单态） */
  articleInfo: CoverPromptInput;
  /** 确保摘要有值：为空时自动生成并写入表单，返回最终可用的摘要（可能为空串） */
  ensureSummary: () => Promise<string>;
}

/**
 * AI 一键配图弹窗：选择官方预设 / 自定义模板 / 临时自定义提示词，
 * 确认后走后端两步生成（文本模型填创意占位符 → 图像模型出图）。
 */
export function AICoverDialog({ isOpen, onOpenChange, onGenerated, articleInfo, ensureSummary }: AICoverDialogProps) {
  const [customTemplates, setCustomTemplates] = useState<CustomCoverTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>(OFFICIAL_COVER_TEMPLATES[0].id);
  const [adHocPrompt, setAdHocPrompt] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  // 打开时拉取自定义模板，并恢复上次使用的模板为默认选中
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let parsed: CustomCoverTemplate[] = [];
    (async () => {
      try {
        const res = await settingsApi.getByKeys([KEY_AI_COVER_TEMPLATES]);
        const raw = res.data?.[KEY_AI_COVER_TEMPLATES];
        // 后端 unflatten 可能把 JSON 字符串解析为对象，统一转回字符串再解析
        const rawStr = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
        parsed = parseCustomTemplates(rawStr);
        if (!cancelled) setCustomTemplates(parsed);
      } catch {
        if (!cancelled) setCustomTemplates([]);
      }

      if (cancelled) return;
      const lastUsed = getLastUsedTemplateId();
      const defaultCustom = parsed.find(t => t.is_default && t.enabled);
      const exists = (id: string | null) =>
        !!id &&
        id !== AD_HOC_TEMPLATE_ID &&
        (OFFICIAL_COVER_TEMPLATES.some(t => t.id === id) || parsed.some(t => t.id === id && t.enabled));
      const defaultId = defaultCustom
        ? defaultCustom.id
        : exists(lastUsed)
          ? lastUsed!
          : OFFICIAL_COVER_TEMPLATES[0].id;
      setSelectedId(defaultId);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const isAdHoc = selectedId === AD_HOC_TEMPLATE_ID;

  /** 预览用提示词（摘要取当前表单值；生成时会用 ensureSummary 的最新结果重建） */
  const previewPrompt = useMemo(() => {
    if (isAdHoc) return fillDataPlaceholders(adHocPrompt, articleInfo);
    return buildPromptFromTemplate(resolveTemplate(selectedId, customTemplates), articleInfo);
  }, [isAdHoc, adHocPrompt, selectedId, customTemplates, articleInfo]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      // 摘要可能为空：先走自动补齐（内部已处理写入表单），再以最新摘要重建提示词
      const ensuredSummary = await ensureSummary();
      const info: CoverPromptInput = { ...articleInfo, summary: ensuredSummary || articleInfo.summary };

      const sourcePrompt = isAdHoc
        ? fillDataPlaceholders(adHocPrompt, info)
        : buildPromptFromTemplate(resolveTemplate(selectedId, customTemplates), info);

      if (!sourcePrompt.trim()) {
        addToast({ title: "提示词为空，请选择模板或填写自定义提示词", color: "warning" });
        return;
      }

      const res = await articleAiApi.cover({ prompt: sourcePrompt });
      const url = res.data?.url;
      if (!url) {
        addToast({ title: "AI 未返回有效图片", color: "warning" });
        return;
      }
      if (!isAdHoc) setLastUsedTemplateId(selectedId);
      onGenerated(url);
      addToast({ title: "AI 配图已生成", color: "success" });
      onOpenChange(false);
    } catch (err) {
      addToast({ title: "AI 配图生成失败", description: getErrorMessage(err), color: "danger" });
    } finally {
      setGenerating(false);
    }
  }, [adHocPrompt, articleInfo, customTemplates, ensureSummary, isAdHoc, onGenerated, onOpenChange, selectedId]);

  const canGenerate = !generating && (isAdHoc ? adHocPrompt.trim() !== "" : true);

  return (
    <AdminDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="2xl"
      scrollBehavior="inside"
      header={{
        title: "AI 一键配图",
        description: "选择海报模板，系统自动填充文章信息后生成封面",
        icon: Sparkles,
      }}
    >
      {() => (
        <div className="px-6 pb-5 space-y-4">
          <div className="space-y-2">
            {[
              ...OFFICIAL_COVER_TEMPLATES.map(t => ({ ...t, enabled: true, is_default: false })),
              ...customTemplates.map(t => ({ ...t, builtIn: false })),
            ]
              .filter(t => t.enabled)
              .map(t => {
                const active = selectedId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                      active ? "border-primary bg-primary/5" : "border-border/60 bg-muted/30 hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t.name || "未命名模板"}</span>
                      {t.builtIn ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-default-100 text-foreground/60">官方</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">自定义</span>
                      )}
                      {t.is_default && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-warning/15 text-warning-600">默认</span>
                      )}
                    </div>
                    {t.description && <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>}
                  </button>
                );
              })}

            <button
              type="button"
              onClick={() => setSelectedId(AD_HOC_TEMPLATE_ID)}
              className={`w-full text-left rounded-xl border p-3 transition-colors cursor-pointer ${
                isAdHoc ? "border-primary bg-primary/5" : "border-border/60 bg-muted/30 hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-2">
                <Wand2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">临时自定义</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-default-100 text-foreground/60">不保存</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">直接粘贴一段提示词，支持 {"{{占位符}}"}</p>
            </button>

            {isAdHoc && (
              <Textarea
                variant="bordered"
                minRows={6}
                maxRows={14}
                maxLength={6000}
                placeholder={"描述你想要的封面，例如：\n核心文字：{{KEYWORDS}}\n中央主体：{{LOGO_OR_SUBJECT}}"}
                value={adHocPrompt}
                onValueChange={setAdHocPrompt}
                classNames={{ inputWrapper: "py-2.5" }}
              />
            )}
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/30">
            <button
              type="button"
              onClick={() => setPreviewOpen(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 cursor-pointer"
            >
              <span className="text-xs font-medium text-foreground/70">
                预览填充后的提示词
                {!hasCreativePlaceholders(previewPrompt) && (
                  <span className="ml-2 text-[10px] text-muted-foreground">纯数据模板 · 将跳过文本模型</span>
                )}
              </span>
              {previewOpen ? (
                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
            {previewOpen && (
              <pre className="px-3 pb-3 pt-1 max-h-60 overflow-auto text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/70 font-sans">
                {previewPrompt}
              </pre>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="light" onPress={() => onOpenChange(false)} isDisabled={generating}>
              取消
            </Button>
            <Button
              color="primary"
              onPress={handleGenerate}
              isDisabled={!canGenerate}
              startContent={generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            >
              {generating ? "生成中…" : "生成封面"}
            </Button>
          </div>
        </div>
      )}
    </AdminDialog>
  );
}
