import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostDetailContent } from "./PostDetailContent";
import { useSiteConfigStore } from "@/store/site-config-store";
import type { Article } from "@/types/article";

vi.mock("./PostHeader", () => ({
  PostHeader: () => <div data-testid="post-header" />,
}));

vi.mock("./ArticleLeadSummary", () => ({
  ArticleLeadSummary: () => <div data-testid="article-summary" />,
}));

vi.mock("./PostContent", () => ({
  PostContent: ({ content }: { content: string }) => <div data-testid="post-content">{content}</div>,
}));

vi.mock("./PostCopyright", () => ({
  PostCopyright: () => <div data-testid="post-copyright" />,
}));

vi.mock("./PostRelatedPosts", () => ({
  PostRelatedPosts: () => <div data-testid="related-posts" />,
}));

vi.mock("./PostPagination", () => ({
  PostPagination: () => <div data-testid="post-pagination" />,
}));

vi.mock("./PostPaginationFloat", () => ({
  PostPaginationFloat: () => <div data-testid="post-pagination-float" />,
}));

vi.mock("./Comment", () => ({
  CommentSection: () => <div data-testid="comment-section" />,
}));

vi.mock("./CommentBarrage", () => ({
  CommentBarrage: () => <div data-testid="comment-barrage" />,
}));

vi.mock("./Sidebar", () => ({
  PostSidebar: () => <div data-testid="post-sidebar" />,
}));

const article: Article = {
  id: "1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  title: "测试文章",
  abbrlink: "test-post",
  content_html: "<p>正文内容</p>",
  word_count: 12,
  reading_time: 1,
  view_count: 0,
  is_reprint: false,
  status: "published",
  post_tags: [],
  post_categories: [],
};

describe("PostDetailContent custom post HTML", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    useSiteConfigStore.setState({
      siteConfig: {
        CUSTOM_POST_TOP_HTML: "<section>顶部 HTML</section>",
        CUSTOM_POST_BOTTOM_HTML: "<footer>底部 HTML</footer>",
      } as Record<string, unknown>,
      isLoaded: true,
    });
  });

  it("在文章正文上下渲染全站文章顶部和底部 HTML", () => {
    render(<PostDetailContent article={article} />);

    const topHTML = document.querySelector('[data-custom-post-html="top"]');
    const bottomHTML = document.querySelector('[data-custom-post-html="bottom"]');
    const postContent = screen.getByTestId("post-content");

    expect(topHTML).toHaveTextContent("顶部 HTML");
    expect(postContent).toHaveTextContent("<p>正文内容</p>");
    expect(bottomHTML).toHaveTextContent("底部 HTML");
    expect(topHTML!.compareDocumentPosition(postContent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(postContent.compareDocumentPosition(bottomHTML!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
