import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tokenManager } from "@/lib/api/client";
import { postManagementKeys } from "@/hooks/queries/use-post-management";
import { useAutoSave } from "./use-auto-save";

const apiMocks = vi.hoisted(() => ({
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
}));

vi.mock("@/lib/api/post-management", () => ({
  postManagementApi: apiMocks,
}));

vi.mock("@/lib/content-processor", () => ({
  processHtmlForSave: (html: string) => html,
}));

vi.mock("@/lib/editor-tabs-export", () => ({
  turndownArticleMarkdown: (_editor: Editor | null, _turndown: unknown, html: string) => `md:${html}`,
}));

vi.mock("@/lib/turndown-rules", () => ({
  registerCustomRules: vi.fn(),
}));

vi.mock("@/lib/marked-extensions", () => ({
  fixTaskListHtml: (html: string) => html,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createEditor(initialHtml = "<p>正文</p>") {
  let html = initialHtml;
  const listeners = new Set<() => void>();
  const editor = {
    isDestroyed: false,
    get isEmpty() {
      return html.trim().length === 0;
    },
    getHTML: () => html,
    on: (event: string, listener: () => void) => {
      if (event === "update") listeners.add(listener);
    },
    off: (event: string, listener: () => void) => {
      if (event === "update") listeners.delete(listener);
    },
  } as unknown as Editor;

  return {
    editor,
    update(nextHtml: string) {
      html = nextHtml;
      listeners.forEach(listener => listener());
    },
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAutoSave", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    tokenManager.setTokenGetter(() => null);
    queryClient.clear();
  });

  it("serializes automatic creation and manual publish into one POST, then keeps PUBLISHED on later autosaves", async () => {
    const editorState = createEditor();
    const creation = deferred<{ id: string }>();
    const onArticleCreated = vi.fn();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    apiMocks.createArticle.mockReturnValueOnce(creation.promise);
    apiMocks.updateArticle.mockResolvedValue({ id: "article-1" });

    const { result } = renderHook(
      () =>
        useAutoSave({
          editor: editorState.editor,
          title: "标题",
          getSubmitData: () => ({ status: "PUBLISHED" }),
          onArticleCreated,
          enabled: false,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    let automaticSave!: Promise<unknown>;
    let manualSave!: Promise<unknown>;
    act(() => {
      automaticSave = result.current.triggerSave();
      manualSave = result.current.saveNow();
    });

    await waitFor(() => expect(apiMocks.createArticle).toHaveBeenCalledTimes(1));
    expect(result.current.isSaving).toBe(true);
    expect(apiMocks.createArticle.mock.calls[0][0]).toMatchObject({ title: "标题", status: "DRAFT" });
    expect(apiMocks.createArticle.mock.calls[0][1]?.idempotencyKey).toEqual(expect.any(String));

    await act(async () => {
      creation.resolve({ id: "article-1" });
      await Promise.all([automaticSave, manualSave]);
    });

    expect(onArticleCreated).toHaveBeenCalledWith("article-1");
    expect(apiMocks.createArticle).toHaveBeenCalledTimes(1);
    expect(apiMocks.updateArticle).toHaveBeenCalledWith(
      "article-1",
      expect.objectContaining({ status: "PUBLISHED" })
    );
    expect(result.current.isSaving).toBe(false);

    editorState.update("<p>修改后的正文</p>");
    await act(async () => {
      await result.current.triggerSave();
    });

    expect(apiMocks.updateArticle).toHaveBeenLastCalledWith(
      "article-1",
      expect.objectContaining({ status: "PUBLISHED" })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: postManagementKeys.lists(),
      refetchType: "all",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: postManagementKeys.detail("article-1"),
      refetchType: "all",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: postManagementKeys.editDetail("article-1"),
      refetchType: "all",
    });
  });

  it("removes scheduling from the protected auto draft and restores it on manual save", async () => {
    const editorState = createEditor("<p>定时正文</p>");
    const scheduledAt = "2030-01-02T03:04:05+08:00";
    apiMocks.createArticle.mockResolvedValue({ id: "scheduled-article" });
    apiMocks.updateArticle.mockResolvedValue({ id: "scheduled-article" });

    const { result } = renderHook(
      () =>
        useAutoSave({
          editor: editorState.editor,
          title: "定时文章",
          getSubmitData: () => ({
            status: "SCHEDULED",
            scheduled_at: scheduledAt,
          }),
          enabled: false,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await result.current.triggerSave();
    });

    expect(apiMocks.createArticle.mock.calls[0][0]).toMatchObject({
      status: "DRAFT",
    });
    expect(apiMocks.createArticle.mock.calls[0][0]).not.toHaveProperty("scheduled_at");

    await act(async () => {
      await result.current.saveNow();
    });

    expect(apiMocks.updateArticle).toHaveBeenLastCalledWith(
      "scheduled-article",
      expect.objectContaining({
        status: "SCHEDULED",
        scheduled_at: scheduledAt,
      })
    );
  });

  it("retries an unknown create result with the same idempotency key and exact payload", async () => {
    const editorState = createEditor("<p>第一次内容</p>");
    apiMocks.createArticle
      .mockRejectedValueOnce(new AxiosError("network", "ERR_NETWORK"))
      .mockResolvedValueOnce({ id: "article-2" });
    apiMocks.updateArticle.mockResolvedValue({ id: "article-2" });

    const hook = renderHook(
      ({ title }) =>
        useAutoSave({
          editor: editorState.editor,
          title,
          getSubmitData: () => ({ status: "PUBLISHED" }),
          enabled: false,
        }),
      {
        initialProps: { title: "第一次标题" },
        wrapper: createWrapper(queryClient),
      }
    );

    let failedSave!: Promise<unknown>;
    act(() => {
      failedSave = hook.result.current.triggerSave();
    });
    let saveError: unknown;
    await act(async () => {
      try {
        await failedSave;
      } catch (error) {
        saveError = error;
      }
    });
    expect(saveError).toBeInstanceOf(AxiosError);
    expect((saveError as Error).message).toBe("network");
    await waitFor(() => expect(hook.result.current.status).toBe("error"));

    const firstPayload = apiMocks.createArticle.mock.calls[0][0];
    const firstOptions = apiMocks.createArticle.mock.calls[0][1];

    editorState.update("<p>第二次内容</p>");
    act(() => {
      hook.rerender({ title: "第二次标题" });
    });

    await act(async () => {
      await hook.result.current.triggerSave();
    });

    expect(apiMocks.createArticle).toHaveBeenCalledTimes(2);
    expect(apiMocks.createArticle.mock.calls[1][0]).toEqual(firstPayload);
    expect(apiMocks.createArticle.mock.calls[1][1]).toEqual(firstOptions);
    expect(apiMocks.updateArticle).toHaveBeenCalledWith(
      "article-2",
      expect.objectContaining({
        title: "第二次标题",
        content_html: "<p>第二次内容</p>",
        status: "DRAFT",
      })
    );
  });

  it("debounces Markdown source changes", async () => {
    vi.useFakeTimers();
    apiMocks.createArticle.mockResolvedValue({ id: "article-3" });
    apiMocks.updateArticle.mockResolvedValue({ id: "article-3" });

    const hook = renderHook(
      ({ sourceContent }) =>
        useAutoSave({
          editor: null,
          title: "源码文章",
          getSubmitData: () => ({ status: "PUBLISHED" }),
          editorMode: "markdown",
          sourceContent,
          interval: 60_000,
        }),
      {
        initialProps: { sourceContent: "# 第一版" },
        wrapper: createWrapper(queryClient),
      }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });
    expect(apiMocks.createArticle).toHaveBeenCalledTimes(1);

    hook.rerender({ sourceContent: "# 第二版" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(apiMocks.updateArticle).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(apiMocks.updateArticle).toHaveBeenCalledWith(
      "article-3",
      expect.objectContaining({ content_md: "# 第二版" })
    );
  });

  it("uses authenticated PUT with keepalive for an existing dirty article before unload", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetchMock);
    tokenManager.setTokenGetter(() => "access-token");
    const editorState = createEditor("<p>离开前内容</p>");

    renderHook(
      () =>
        useAutoSave({
          articleId: "article-4",
          editor: editorState.editor,
          title: "离开前标题",
          getSubmitData: () => ({ status: "PUBLISHED" }),
          enabled: true,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    const unloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloadEvent);

    expect(unloadEvent.defaultPrevented).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/articles/article-4",
      expect.objectContaining({
        method: "PUT",
        keepalive: true,
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        }),
      })
    );
  });

  it("clears the auto-created draft guard when a manual retry replays the same DRAFT snapshot", async () => {
    const editorState = createEditor("<p>草稿内容</p>");
    let status = "DRAFT";
    apiMocks.createArticle
      .mockRejectedValueOnce(new AxiosError("network", "ERR_NETWORK"))
      .mockResolvedValueOnce({ id: "article-5" });
    apiMocks.updateArticle.mockResolvedValue({ id: "article-5" });

    const hook = renderHook(
      () =>
        useAutoSave({
          editor: editorState.editor,
          title: "草稿标题",
          getSubmitData: () => ({ status }),
          enabled: false,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    let failedSave!: Promise<unknown>;
    act(() => {
      failedSave = hook.result.current.triggerSave();
    });
    await act(async () => {
      await failedSave.catch(() => undefined);
    });

    await act(async () => {
      await hook.result.current.saveNow();
    });
    expect(apiMocks.updateArticle).not.toHaveBeenCalled();

    status = "PUBLISHED";
    editorState.update("<p>发布后的修改</p>");
    await act(async () => {
      await hook.result.current.triggerSave();
    });

    expect(apiMocks.updateArticle).toHaveBeenCalledWith(
      "article-5",
      expect.objectContaining({ status: "PUBLISHED" })
    );
  });

  it("uses a new key and latest payload after a deterministic create failure", async () => {
    const editorState = createEditor("<p>旧内容</p>");
    apiMocks.createArticle.mockRejectedValueOnce(new Error("validation")).mockResolvedValueOnce({ id: "article-6" });

    const hook = renderHook(
      ({ title }) =>
        useAutoSave({
          editor: editorState.editor,
          title,
          getSubmitData: () => ({ status: "PUBLISHED" }),
          enabled: false,
        }),
      {
        initialProps: { title: "旧标题" },
        wrapper: createWrapper(queryClient),
      }
    );

    let failedSave!: Promise<unknown>;
    act(() => {
      failedSave = hook.result.current.triggerSave();
    });
    await act(async () => {
      await failedSave.catch(() => undefined);
    });

    editorState.update("<p>新内容</p>");
    act(() => hook.rerender({ title: "新标题" }));
    await act(async () => {
      await hook.result.current.triggerSave();
    });

    expect(apiMocks.createArticle.mock.calls[1][0]).toMatchObject({
      title: "新标题",
      content_html: "<p>新内容</p>",
    });
    expect(apiMocks.createArticle.mock.calls[1][1]?.idempotencyKey).not.toBe(
      apiMocks.createArticle.mock.calls[0][1]?.idempotencyKey
    );
  });

  it("replays a 5xx create failure with the same key and frozen payload", async () => {
    const editorState = createEditor("<p>服务端未知结果</p>");
    const transportError = new AxiosError("server", "ERR_BAD_RESPONSE");
    Object.defineProperty(transportError, "response", {
      value: { status: 500 },
    });
    const surfacedError = new Error("服务器内部错误", { cause: transportError });
    apiMocks.createArticle.mockRejectedValueOnce(surfacedError).mockResolvedValueOnce({ id: "article-7" });

    const { result } = renderHook(
      () =>
        useAutoSave({
          editor: editorState.editor,
          title: "服务端错误",
          getSubmitData: () => ({ status: "PUBLISHED" }),
          enabled: false,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    let failedSave!: Promise<unknown>;
    act(() => {
      failedSave = result.current.triggerSave();
    });
    await act(async () => {
      await failedSave.catch(() => undefined);
    });

    const firstPayload = apiMocks.createArticle.mock.calls[0][0];
    const firstOptions = apiMocks.createArticle.mock.calls[0][1];
    await act(async () => {
      await result.current.triggerSave();
    });

    expect(apiMocks.createArticle).toHaveBeenCalledTimes(2);
    expect(apiMocks.createArticle.mock.calls[1][0]).toEqual(firstPayload);
    expect(apiMocks.createArticle.mock.calls[1][1]).toEqual(firstOptions);
  });

  it("requests a browser warning when a dirty new article has no ID", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const editorState = createEditor("<p>未创建的内容</p>");

    renderHook(
      () =>
        useAutoSave({
          editor: editorState.editor,
          title: "",
          getSubmitData: () => ({ status: "PUBLISHED" }),
          enabled: true,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
