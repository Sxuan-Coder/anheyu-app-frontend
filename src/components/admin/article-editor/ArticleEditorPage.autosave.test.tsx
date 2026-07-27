import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleEditorPage } from "./ArticleEditorPage";

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  push: vi.fn(),
  flushSave: vi.fn(),
  saveNow: vi.fn(),
  metaStatus: "PUBLISHED",
  useAutoSaveOptions: undefined as Record<string, unknown> | undefined,
  headerProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@heroui/react", () => ({
  addToast: mocks.addToast,
  Spinner: () => <div>loading</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock("./EditorHeader", () => ({
  EditorHeader: (props: Record<string, unknown>) => {
    mocks.headerProps = props;
    return (
      <>
        <button type="button" onClick={() => void (props.onBack as () => Promise<void>)()}>
          返回文章列表
        </button>
        <button type="button" onClick={() => void (props.onSave as () => Promise<void>)()}>
          发布
        </button>
      </>
    );
  },
}));

vi.mock("./EditorToolbar", () => ({
  EditorToolbar: () => null,
}));
vi.mock("./TiptapEditor", () => ({
  TiptapEditor: () => null,
}));
vi.mock("./SourceCodeEditor", () => ({
  SourceCodeEditor: () => null,
}));
vi.mock("./EditorSidebar", () => ({
  EditorSidebar: () => null,
  TOCContent: () => null,
}));
vi.mock("./MobileToolbar", () => ({
  MobileToolbar: () => null,
}));

const editor = {
  isDestroyed: false,
  isEmpty: false,
  getHTML: () => "<p>正文</p>",
  getText: () => "正文",
  on: vi.fn(),
  off: vi.fn(),
  commands: { setContent: vi.fn() },
  state: { doc: { textContent: "正文" } },
} as unknown as Editor;

vi.mock("./use-article-editor", () => ({
  useArticleEditor: () => editor,
}));

vi.mock("./use-article-meta", () => ({
  useArticleMeta: () => ({
    meta: {
      status: mocks.metaStatus,
      is_doc: false,
    },
    updateField: vi.fn(),
    initFromData: vi.fn(),
    getSubmitData: () => ({ status: mocks.metaStatus }),
  }),
}));

vi.mock("./use-auto-save", () => ({
  useAutoSave: (options: Record<string, unknown>) => {
    mocks.useAutoSaveOptions = options;
    return {
      status: "saving",
      lastSavedAt: null,
      isSaving: true,
      triggerSave: vi.fn(),
      saveNow: mocks.saveNow,
      flushSave: mocks.flushSave,
    };
  },
}));

vi.mock("@/hooks/queries/use-post-management", () => ({
  useArticleForEdit: () => ({ data: undefined, isLoading: false }),
  useCreateArticle: () => ({ isPending: false }),
  useUpdateArticle: () => ({ isPending: false }),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: { user: undefined; roles: string[] }) => unknown) =>
    selector({ user: undefined, roles: [] }),
}));

vi.mock("@/lib/article-summary", () => ({
  plainTextFromHtmlSource: () => "",
  roughPlainTextFromMarkdown: () => "",
}));

vi.mock("@/lib/content-processor", () => ({
  processHtmlForSave: (html: string) => html,
}));
vi.mock("@/lib/editor-tabs-export", () => ({
  turndownArticleMarkdown: () => "",
}));
vi.mock("@/lib/turndown-rules", () => ({
  registerCustomRules: vi.fn(),
}));
vi.mock("@/lib/marked-extensions", () => ({
  registerMarkedExtensions: vi.fn(),
  fixTaskListHtml: (html: string) => html,
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPage() {
  return render(<ArticleEditorPage />);
}

describe("ArticleEditorPage autosave coordination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.metaStatus = "PUBLISHED";
    mocks.flushSave.mockResolvedValue(undefined);
    mocks.saveNow.mockResolvedValue({ id: "article-1", created: false, saved: true });
  });

  it("waits for the latest save before navigating back", async () => {
    const pending = deferred();
    mocks.flushSave.mockReturnValueOnce(pending.promise);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "返回文章列表" }));
    expect(mocks.push).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/admin/post-management"));
  });

  it("stays in the editor and reports an error when the final save fails", async () => {
    mocks.flushSave.mockRejectedValueOnce(new Error("network"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "返回文章列表" }));

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "保存失败，已留在当前页面",
          color: "danger",
        })
      )
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("updates the URL in place after automatic creation and includes autosave in the button state", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderPage();

    await act(async () => {
      (mocks.useAutoSaveOptions?.onArticleCreated as (id: string) => void)("created-id");
    });

    expect(replaceState).toHaveBeenCalledWith(
      window.history.state,
      "",
      "/admin/post-management/created-id/edit"
    );
    expect(mocks.headerProps).toMatchObject({
      articleId: "created-id",
      isEditMode: true,
      isSaving: true,
    });
  });

  it("does not report success or leave when a new empty draft has nothing to save", async () => {
    mocks.metaStatus = "DRAFT";
    mocks.saveNow.mockResolvedValueOnce({ created: false, saved: false });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() =>
      expect(mocks.addToast).toHaveBeenCalledWith({
        title: "没有可保存的内容",
        color: "warning",
      })
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
