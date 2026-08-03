"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Editor } from "@tiptap/react";
import axios from "axios";
import TurndownService from "turndown";
import { marked } from "marked";
import { postManagementApi } from "@/lib/api/post-management";
import { processHtmlForSave } from "@/lib/content-processor";
import { turndownArticleMarkdown } from "@/lib/editor-tabs-export";
import { registerCustomRules } from "@/lib/turndown-rules";
import { fixTaskListHtml } from "@/lib/marked-extensions";
import { tokenManager } from "@/lib/api/client";
import { postManagementKeys } from "@/hooks/queries/use-post-management";
import type { CreateArticleRequest, UpdateArticleRequest } from "@/types/post-management";
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

export interface SaveOutcome {
  id?: string;
  created: boolean;
  saved: boolean;
}

interface UseAutoSaveReturn {
  /** 当前自动保存状态 */
  status: AutoSaveStatus;
  /** 上次保存的时间 */
  lastSavedAt: Date | null;
  /** 自动或手动保存队列中是否仍有任务 */
  isSaving: boolean;
  /** 手动触发一次自动保存 */
  triggerSave: () => Promise<SaveOutcome>;
  /** 用户点击保存/发布，和自动保存共用同一串行队列 */
  saveNow: () => Promise<SaveOutcome>;
  /** 离开编辑器前保存最新快照 */
  flushSave: () => Promise<SaveOutcome>;
}

interface SaveSnapshot {
  data: CreateArticleRequest;
  hash: string;
  isEmptyContent: boolean;
}

type SaveIntent = "auto" | "manual";

interface PendingCreate {
  idempotencyKey: string;
  intent: SaveIntent;
  payload: CreateArticleRequest;
  hash: string;
}

/** HTML -> Markdown 转换器（单例） */
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
registerCustomRules(turndownService);

const AxiosErrorCodes = {
  timeout: "ETIMEDOUT",
  aborted: "ECONNABORTED",
} as const;

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `article-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasUnknownCreateResult(error: unknown): boolean {
  const transportError = axios.isAxiosError(error)
    ? error
    : error instanceof Error && axios.isAxiosError(error.cause)
      ? error.cause
      : null;
  if (!transportError) return false;

  const responseStatus = transportError.response?.status;
  return (
    !transportError.response ||
    transportError.code === AxiosErrorCodes.timeout ||
    transportError.code === AxiosErrorCodes.aborted ||
    responseStatus === 408 ||
    responseStatus === 429 ||
    (responseStatus !== undefined && responseStatus >= 500)
  );
}

/**
 * 自动保存 Hook
 *
 * 自动保存、手动保存和离开前刷新共用同一个串行队列。新文章创建在结果未知时
 * 会保留原始请求体与 Idempotency-Key，下一次保存先安全重放该请求。
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
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const lastContentHashRef = useRef("");
  const activeArticleIdRef = useRef<string | undefined>(articleId);
  const autoCreatedDraftRef = useRef(false);
  const pendingCreateRef = useRef<PendingCreate | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSaveCountRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeArticleIdRef.current = articleId;
  }, [articleId]);

  const buildSnapshot = useCallback(
    (intent: SaveIntent): SaveSnapshot | null => {
      let isEmptyContent: boolean;
      let html: string;
      let markdown: string;

      if (editorMode === "visual") {
        if (!editor || editor.isDestroyed) return null;
        const contentForSave = editor.getHTML();
        isEmptyContent = editor.isEmpty;
        html = processHtmlForSave(contentForSave);
        markdown = turndownArticleMarkdown(editor, turndownService, html);
      } else if (editorMode === "html") {
        isEmptyContent = sourceContent.trim().length === 0;
        html = processHtmlForSave(sourceContent);
        markdown = turndownService.turndown(html);
      } else {
        isEmptyContent = sourceContent.trim().length === 0;
        markdown = sourceContent;
        html = processHtmlForSave(fixTaskListHtml(marked.parse(sourceContent, { async: false }) as string));
      }

      const targetArticleId = activeArticleIdRef.current;
      const data = {
        ...getSubmitData(),
        title: title.trim(),
        content_html: html,
        content_md: markdown,
      } as CreateArticleRequest;

      if (intent === "auto" && (!targetArticleId || autoCreatedDraftRef.current)) {
        data.status = "DRAFT";
        delete data.scheduled_at;
      }

      return {
        data,
        hash: JSON.stringify(data),
        isEmptyContent,
      };
    },
    [editor, editorMode, getSubmitData, sourceContent, title]
  );

  const invalidateArticleQueries = useCallback(
    async (id: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: postManagementKeys.lists(), refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: postManagementKeys.detail(id), refetchType: "all" }),
        queryClient.invalidateQueries({ queryKey: postManagementKeys.editDetail(id), refetchType: "all" }),
      ]);
    },
    [queryClient]
  );

  const finishCreatedArticle = useCallback(
    async (createdId: string, pending: PendingCreate) => {
      activeArticleIdRef.current = createdId;
      autoCreatedDraftRef.current = pending.intent === "auto" && pending.payload.status === "DRAFT";
      pendingCreateRef.current = null;
      lastContentHashRef.current = pending.hash;
      setLastSavedAt(new Date());
      onArticleCreated?.(createdId);
      await invalidateArticleQueries(createdId);
    },
    [invalidateArticleQueries, onArticleCreated]
  );

  const replayPendingCreate = useCallback(async (): Promise<string | undefined> => {
    const pending = pendingCreateRef.current;
    if (!pending) return undefined;

    try {
      const created = await postManagementApi.createArticle(pending.payload, {
        idempotencyKey: pending.idempotencyKey,
      });
      await finishCreatedArticle(created.id, pending);
      return created.id;
    } catch (error) {
      if (!hasUnknownCreateResult(error)) {
        pendingCreateRef.current = null;
      }
      throw error;
    }
  }, [finishCreatedArticle]);

  const performSave = useCallback(
    async (intent: SaveIntent): Promise<SaveOutcome> => {
      if (pendingCreateRef.current) {
        const createdId = await replayPendingCreate();
        const latestSnapshot = buildSnapshot(intent);
        if (!createdId || !latestSnapshot || latestSnapshot.hash === lastContentHashRef.current) {
          if (createdId && intent === "manual") {
            autoCreatedDraftRef.current = false;
          }
          return { id: createdId, created: true, saved: true };
        }

        await postManagementApi.updateArticle(createdId, latestSnapshot.data as UpdateArticleRequest);
        if (intent === "manual") {
          autoCreatedDraftRef.current = false;
        }
        lastContentHashRef.current = latestSnapshot.hash;
        setLastSavedAt(new Date());
        await invalidateArticleQueries(createdId);
        return { id: createdId, created: true, saved: true };
      }

      const snapshot = buildSnapshot(intent);
      if (!snapshot) {
        return { id: activeArticleIdRef.current, created: false, saved: false };
      }

      const targetArticleId = activeArticleIdRef.current;
      if (!targetArticleId && !snapshot.data.title && snapshot.isEmptyContent) {
        return { created: false, saved: false };
      }
      if (snapshot.hash === lastContentHashRef.current) {
        return { id: targetArticleId, created: false, saved: false };
      }

      if (targetArticleId) {
        await postManagementApi.updateArticle(targetArticleId, snapshot.data as UpdateArticleRequest);
        if (intent === "manual") {
          autoCreatedDraftRef.current = false;
        }
        lastContentHashRef.current = snapshot.hash;
        setLastSavedAt(new Date());
        await invalidateArticleQueries(targetArticleId);
        return { id: targetArticleId, created: false, saved: true };
      }

      const pending: PendingCreate = {
        idempotencyKey: createIdempotencyKey(),
        intent,
        payload: snapshot.data,
        hash: snapshot.hash,
      };
      pendingCreateRef.current = pending;

      try {
        const created = await postManagementApi.createArticle(pending.payload, {
          idempotencyKey: pending.idempotencyKey,
        });
        await finishCreatedArticle(created.id, pending);
        return { id: created.id, created: true, saved: true };
      } catch (error) {
        if (!hasUnknownCreateResult(error)) {
          pendingCreateRef.current = null;
        }
        throw error;
      }
    },
    [buildSnapshot, finishCreatedArticle, invalidateArticleQueries, replayPendingCreate]
  );

  const enqueueSave = useCallback(
    (intent: SaveIntent): Promise<SaveOutcome> => {
      pendingSaveCountRef.current += 1;
      setIsSaving(true);
      setStatus("saving");

      const task = saveQueueRef.current.then(() => performSave(intent));
      saveQueueRef.current = task.then(
        () => undefined,
        () => undefined
      );

      const finish = (nextStatus: AutoSaveStatus) => {
        pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
        if (pendingSaveCountRef.current === 0) {
          setIsSaving(false);
          setStatus(nextStatus);
        }
      };
      task.then(
        outcome => finish(outcome.saved ? "saved" : "idle"),
        () => finish("error")
      );

      return task;
    },
    [performSave]
  );

  const triggerSave = useCallback(() => enqueueSave("auto"), [enqueueSave]);
  const saveNow = useCallback(() => enqueueSave("manual"), [enqueueSave]);
  const flushSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return enqueueSave("auto");
  }, [enqueueSave]);

  const scheduleDebouncedSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void triggerSave().catch(() => undefined);
    }, 3000);
  }, [triggerSave]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      void triggerSave().catch(() => undefined);
    }, interval);
    return () => clearInterval(timer);
  }, [enabled, interval, triggerSave]);

  useEffect(() => {
    if (!enabled || editorMode !== "visual" || !editor || editor.isDestroyed) return;
    editor.on("update", scheduleDebouncedSave);
    return () => {
      editor.off("update", scheduleDebouncedSave);
    };
  }, [editor, editorMode, enabled, scheduleDebouncedSave]);

  useEffect(() => {
    if (!enabled) return;
    scheduleDebouncedSave();
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [editorMode, enabled, scheduleDebouncedSave, sourceContent, title]);

  useEffect(() => {
    if (!enabled) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const snapshot = buildSnapshot("auto");
      if (!snapshot || snapshot.hash === lastContentHashRef.current) return;

      const targetArticleId = activeArticleIdRef.current;
      if (!targetArticleId) {
        if (!snapshot.data.title && snapshot.isEmptyContent) return;
        event.preventDefault();
        event.returnValue = "";
        return;
      }

      const token = tokenManager.getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      event.preventDefault();
      event.returnValue = "";
      void fetch(`/api/articles/${targetArticleId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(snapshot.data),
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [buildSnapshot, enabled]);

  return {
    status,
    lastSavedAt,
    isSaving,
    triggerSave,
    saveNow,
    flushSave,
  };
}
