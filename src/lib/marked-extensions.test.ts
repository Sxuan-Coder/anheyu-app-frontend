import { beforeAll, describe, expect, it } from "vitest";
import { marked } from "marked";
import { registerMarkedExtensions } from "@/lib/marked-extensions";

beforeAll(() => {
  registerMarkedExtensions(marked);
});

describe("marked video gallery extension", () => {
  it("adds a first-frame fragment for mobile browsers when poster is missing", () => {
    const html = marked.parse(
      `:::video-gallery
url=/static/video-mobile.mp4?token=abc title=移动端 type=video/mp4
:::`,
      { async: false },
    ) as string;

    expect(html).toContain('src="/static/video-mobile.mp4?token=abc#t=0.001"');
    expect(html).toContain('<source src="/static/video-mobile.mp4?token=abc#t=0.001" type="video/mp4" />');
    expect(html).not.toContain('poster=""');
  });

  it("renders published video gallery with article detail styling contract", () => {
    const html = marked.parse(
      `:::video-gallery cols=2 gap=20px ratio=16:9
url=/static/video-a.mp4 poster=/static/video-a.jpg title=视频A desc=第一段 type=video/mp4
url=/static/video-b.webm title=视频B desc=第二段 type=video/webm
:::`,
      { async: false },
    ) as string;

    expect(html).toContain("video-gallery-container video-gallery-cols-2 video-gallery-count-2");
    expect(html).toContain('style="gap:20px;--video-gallery-ratio:56.25%;"');
    expect(html).toContain('<div class="video-gallery-video-wrapper">');
    expect(html).toContain(
      '<video class="video-gallery-video" controls preload="metadata" playsinline webkit-playsinline="true" x5-playsinline="true" x5-video-player-type="h5" src="/static/video-a.mp4" poster="/static/video-a.jpg">',
    );
    expect(html).toContain(
      '<video class="video-gallery-video" controls preload="metadata" playsinline webkit-playsinline="true" x5-playsinline="true" x5-video-player-type="h5" src="/static/video-b.webm#t=0.001">',
    );
    expect(html).toContain('<source src="/static/video-a.mp4" type="video/mp4" />');
    expect(html).toContain('<source src="/static/video-b.webm#t=0.001" type="video/webm" />');
    expect(html).toContain('<div class="video-gallery-caption"><div class="video-gallery-title">视频A</div><div class="video-gallery-desc">第一段</div></div>');
    expect(html).toContain('<div class="video-gallery-caption"><div class="video-gallery-title">视频B</div><div class="video-gallery-desc">第二段</div></div>');
  });
});

describe("marked admonition extension", () => {
  it.each([
    ["note", "注意"],
    ["info", "信息"],
    ["tip", "提示"],
    ["success", "成功"],
    ["warning", "警告"],
    ["danger", "危险"],
  ])("保留 %s 默认标题块的正文首行和相邻内容", (type, defaultTitle) => {
    const html = marked.parse(`!!! ${type}\n正文第一行\n!!!\n相邻内容`, { async: false }) as string;

    expect(html).toContain(`<div class="admonition ${type}">`);
    expect(html).toContain(`<div class="admonition-title">${defaultTitle}</div>`);
    expect(html).toContain("<p>正文第一行</p>");
    const output = document.createElement("div");
    output.innerHTML = html;
    const admonition = output.querySelector(`.admonition.${type}`);
    expect(admonition?.nextElementSibling).toBeInstanceOf(HTMLParagraphElement);
    expect(admonition?.nextElementSibling).toHaveTextContent("相邻内容");
  });

  it("仅接受起始标记和类型之间的水平空白", () => {
    const html = marked.parse("!!!\nnote\n不应解析\n!!!", { async: false }) as string;

    expect(html).not.toContain('class="admonition note"');
  });

  it("识别 CRLF、EOF 闭合符和自定义标题中的 Markdown 正文", () => {
    const html = marked.parse("!!! tip 自定义标题\r\n**加粗正文**\r\n!!!", { async: false }) as string;

    expect(html).toContain('<div class="admonition tip">');
    expect(html).toContain('<div class="admonition-title">自定义标题</div>');
    expect(html).toContain("<p><strong>加粗正文</strong></p>");
  });

  it("仅将独立一行的 !!! 视为闭合符，并跳过代码围栏内的标记", () => {
    const html = marked.parse(`!!! note
正文 !!!
\`\`\`
!!!
\`\`\`
!!!
相邻内容`, { async: false }) as string;

    expect(html).toContain("<p>正文 !!!</p>");
    expect(html).toContain("<code>!!!\n</code>");
    expect(html).toContain("<p>相邻内容</p>");
  });

  it("不会将无效的类型近似行计为嵌套 Admonition 起始", () => {
    const html = marked.parse("!!! note 外层\n!!! note-like 保留为正文\n!!!", { async: false }) as string;

    expect(html).toContain('<div class="admonition note">');
    expect(html).toContain("<p>!!! note-like 保留为正文</p>");
  });

  it("识别外层闭合位于 EOF 的实际嵌套 Admonition", () => {
    const html = marked.parse(`!!! note 外层标题
外层正文
!!! warning 内层标题
内层正文
!!!
!!!`, { async: false }) as string;
    const output = document.createElement("div");
    output.innerHTML = html;

    const outer = output.querySelector(".admonition.note");
    const outerBody = outer?.querySelector(".admonition-body");
    const inner = outerBody?.querySelector(".admonition.warning");

    expect(outer?.querySelector(".admonition-title")).toHaveTextContent("外层标题");
    expect(outerBody).toHaveTextContent("外层正文");
    expect(inner?.querySelector(".admonition-title")).toHaveTextContent("内层标题");
    expect(inner?.querySelector(".admonition-body")).toHaveTextContent("内层正文");
  });
});
