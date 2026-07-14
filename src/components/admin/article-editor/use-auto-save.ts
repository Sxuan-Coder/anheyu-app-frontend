"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import { postManagementApi } from "@/lib/api/post-management";
import { processHtmlForSave } from "@/lib/content-processor";
import TurndownService from "turndown";
import { turndownArticleMarkdown } from "@/lib/editor-tabs-export";
import { registerCustomRules } from "@/lib/turndown-rules";
import { marked } from "marked";
import { fixTaskListHtml } from "@/lib/marked-extensions";
import type { EditorMode } from "./EditorToolbar";

/** 自动保存状态 */
export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  /** 文章 ID（仅编辑模式时有效） */
  articleId?: string;
  /** 自动保存第一次创建出草稿后，把新文章 ID 回传给页面 */
  onArticleCreated?: (id: string) => void;
  /** 编辑器实例 */
  editor: Editor | null;
  /** 标题 */
  title: string;
  /** 获取元数据的函数 */
  getSubmitData: () => Record<string, unknown>;
  /** 自动保存间隔（毫秒），默认 30 秒 */
  interval?: number;
  /** 是否启用自动保存 */
  enabled?: boolean;
  /** 当前编辑模式 */
  editorMode?: EditorMode;
  /** 源码模式下的内容 */
  sourceContent?: string;
}

interface UseAutoSaveReturn {
  /** 当前自动保存状态 */
  status: AutoSaveStatus;
  /** 上次保存的时间 */
  lastSavedAt: Date | null;
  /** 手动触发保存 */
  triggerSave: () => void;
  /** 标记为已保存（供手动保存成功后调用，同步状态和内容哈希） */
  markAsSaved: () => void;
}

/** HTML -> Markdown 转换器（单例） */
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
registerCustomRules(turndownService);

/**
 * 自动保存 Hook
 *
 * 在编辑模式下，定期检测内容变化并自动保存。
 * 使用内容哈希判断是否有变化，避免无意义的保存。
 */
export function useAutoSave({
  articleId,
  onArticleCreated,
  editor,
  title,
  getSubmitData,
  interval = 30000,
  enabled = true,
  editorMode = "visual",
  sourceContent = "",
}: UseAutoSaveOptions): UseAutoSaveReturn {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // 用于追踪上次保存的内容哈希，避免重复保存
  const lastContentHashRef = useRef<string>("");
  const savingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCreatedDraftRef = useRef(false);

  /**
   * 当前自动保存使用的文章 ID
   * 编辑模式下来自 props.articleId；
   * 新建模式下，第一次 createArticle 成功后写入这里
   */
  const activeArticleIdRef = useRef<string | undefined>(articleId);

  useEffect(() => {
    activeArticleIdRef.current = articleId;
  }, [articleId]);

  /** 计算内容的简单哈希 */
  const computeHash = useCallback((t: string, html: string) => {
    // 使用简单的字符串拼接作为哈希（足以检测变化）
    return `${t}::${html.length}::${html.slice(0, 200)}::${html.slice(-200)}`;
  }, []);

  /** 执行保存 */
  const doSave = useCallback(async () => {
    if (savingRef.current) return;

    let contentForHash: string;
    let isEmptyContent = false;

    if (editorMode === "visual") {
      if (!editor || editor.isDestroyed) return;

      contentForHash = editor.getHTML();

      isEmptyContent = editor.isEmpty;
    } else {
      contentForHash = sourceContent;

      // HTML / Markdown 源码模式下，用 trim 判断是否为空
      isEmptyContent = sourceContent.trim().length === 0;
    }

    const trimmedTitle = title.trim();

    // 新建文章：标题和正文都为空时，不创建空草稿
    if (!activeArticleIdRef.current && !trimmedTitle && isEmptyContent) {
      return;
    }

    const hash = computeHash(trimmedTitle, contentForHash);
    if (hash === lastContentHashRef.current) return;

    savingRef.current = true;
    setStatus("saving");

    try {
      let html: string;
      let markdown: string;

      if (editorMode === "visual") {
        html = processHtmlForSave(contentForHash);
        markdown = turndownArticleMarkdown(editor, turndownService, html);
      } else if (editorMode === "html") {
        html = processHtmlForSave(sourceContent);
        markdown = turndownService.turndown(html);
      } else {
        markdown = sourceContent;
        html = processHtmlForSave(fixTaskListHtml(marked.parse(sourceContent, { async: false }) as string));
      }

      const metaData = getSubmitData();
      const targetArticleId = activeArticleIdRef.current;

      if (targetArticleId) {
        const updateData: Record<string, unknown> = {
          title: trimmedTitle,
          content_html: html,
          content_md: markdown,
          ...metaData,
        };
        if (autoCreatedDraftRef.current) {
          updateData.status = "DRAFT";
        }
        await postManagementApi.updateArticle(targetArticleId, updateData);
      } else {
        // 新建文章还没有 ID 第一次自动保存时创建草稿
        const created = await postManagementApi.createArticle({
          ...metaData,
          title: trimmedTitle,  // 标题允许为空字符串
          content_html: html,
          content_md: markdown,
          status: "DRAFT",
        });

        activeArticleIdRef.current = created.id;
        autoCreatedDraftRef.current = true;

        // ArticleEditorPage 保存此 ID
        onArticleCreated?.(created.id);
      }

      lastContentHashRef.current = hash;
      setLastSavedAt(new Date());
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, [editor, title, getSubmitData, computeHash, editorMode, sourceContent, onArticleCreated]);

  /** 手动触发保存 */
  const triggerSave = useCallback(() => {
    doSave();
  }, [doSave]);

  /** 标记为已保存（供手动保存成功后调用） */
  const markAsSaved = useCallback(() => {
    if (editorMode === "visual") {
      if (editor && !editor.isDestroyed) {
        lastContentHashRef.current = computeHash(title, editor.getHTML());
      }
    } else {
      lastContentHashRef.current = computeHash(title, sourceContent);
    }
    setLastSavedAt(new Date());
    setStatus("saved");
  }, [editor, title, computeHash, editorMode, sourceContent]);

  // 定时器：定期检测并保存
  useEffect(() => {
    if (!enabled) return;

    timerRef.current = setInterval(() => {
      doSave();
    }, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, interval, doSave]);

  // 输入停止 3 秒后自动保存
  useEffect(() => {
    if (!enabled) return;
    if (editorMode !== "visual") return;
    if (!editor || editor.isDestroyed) return;

    const scheduleSave = () => {
      // 如果用户持续输入，就清掉上一次定时器，重新计时
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // 用户停止输入 3 秒后保存
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, 3000);
    };

    // Tiptap 编辑器内容变化时触发
    editor.on("update", scheduleSave);

    return () => {
      // 组件卸载或 editor 变化时，移除监听，避免重复绑定
      editor.off("update", scheduleSave);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [enabled, editor, editorMode, doSave]);

  // 页面卸载前尝试保存
  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = () => {
      const targetArticleId = activeArticleIdRef.current;

      // 没有 ID 的新文章，不在 unload 时创建，第一次创建交正常自动保存定时器做
      if (!targetArticleId) return;

      let contentForHash: string;
      if (editorMode === "visual") {
        if (!editor || editor.isDestroyed) return;
        contentForHash = editor.getHTML();
      } else {
        contentForHash = sourceContent;
      }

      const hash = computeHash(title, contentForHash);
      if (hash !== lastContentHashRef.current) {
        let html: string;
        let markdown: string;
        if (editorMode === "visual") {
          html = processHtmlForSave(contentForHash);
          markdown = turndownArticleMarkdown(editor, turndownService, html);
        } else if (editorMode === "html") {
          html = processHtmlForSave(sourceContent);
          markdown = turndownService.turndown(html);
        } else {
          markdown = sourceContent;
          html = processHtmlForSave(fixTaskListHtml(marked.parse(sourceContent, { async: false }) as string));
        }
        const data = JSON.stringify({ title: title.trim(), content_html: html, content_md: markdown });
        navigator.sendBeacon?.(`/api/articles/${targetArticleId}`, new Blob([data], { type: "application/json" }));
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled, editor, title, computeHash, editorMode, sourceContent]);

  return { status, lastSavedAt, triggerSave, markAsSaved };
}
