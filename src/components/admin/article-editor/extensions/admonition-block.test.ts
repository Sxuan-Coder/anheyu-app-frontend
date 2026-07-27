import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TurndownService from "turndown";
import { afterEach, describe, expect, it } from "vitest";
import { registerCustomRules } from "@/lib/turndown-rules";
import { AdmonitionBlock } from "./admonition-block";

let editor: Editor | null = null;

function createEditor(content: string) {
  editor = new Editor({
    extensions: [StarterKit, AdmonitionBlock],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("AdmonitionBlock HTML parsing", () => {
  it.each(["note", "info", "tip", "success", "warning", "danger"])(
    "将旧版 %s HTML 恢复为 AdmonitionBlock，且标题不进入正文",
    type => {
      const instance = createEditor(
        `<div class="md-editor-admonition md-editor-admonition-${type}"><div class="md-editor-admonition-title">旧标题</div><p>旧正文</p></div>`,
      );

      expect(instance.getJSON()).toMatchObject({
        type: "doc",
        content: [
          {
            type: "admonitionBlock",
            attrs: { admonitionType: type, title: "旧标题" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "旧正文" }] }],
          },
        ],
      });
      expect(instance.getText()).toContain("旧正文");
      expect(instance.getText()).not.toContain("旧标题");
      const output = document.createElement("div");
      output.innerHTML = instance.getHTML();
      expect(output.querySelector(`div.admonition.${type} > .admonition-title + .admonition-body`)).not.toBeNull();
      expect(output.querySelector(".admonition-title")).toHaveTextContent("旧标题");
      expect(output.querySelector(".admonition-body")).toHaveTextContent("旧正文");
    },
  );

  it("将未标注旧类型的 Admonition 默认为 note", () => {
    const instance = createEditor(
      '<div class="md-editor-admonition"><div class="md-editor-admonition-title">默认标题</div><p>默认正文</p></div>',
    );

    expect(instance.getJSON()).toMatchObject({
      content: [{ type: "admonitionBlock", attrs: { admonitionType: "note", title: "默认标题" } }],
    });
  });

  it("不会将嵌套旧 Admonition 的标题当作父块标题或从正文删除", () => {
    const instance = createEditor(
      '<div class="md-editor-admonition md-editor-admonition-note"><p>外层正文</p><div class="md-editor-admonition md-editor-admonition-warning"><div class="md-editor-admonition-title">内层标题</div><p>内层正文</p></div></div>',
    );

    expect(instance.getJSON()).toMatchObject({
      content: [
        {
          type: "admonitionBlock",
          attrs: { admonitionType: "note", title: "" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "外层正文" }] },
            {
              type: "admonitionBlock",
              attrs: { admonitionType: "warning", title: "内层标题" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "内层正文" }] }],
            },
          ],
        },
      ],
    });
  });

  it("继续解析当前 admonition HTML", () => {
    const instance = createEditor(
      '<div class="admonition danger"><div class="admonition-title">当前标题</div><div class="admonition-body"><p>当前正文</p></div></div>',
    );

    expect(instance.getJSON()).toMatchObject({
      content: [
        {
          type: "admonitionBlock",
          attrs: { admonitionType: "danger", title: "当前标题" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "当前正文" }] }],
        },
      ],
    });
  });

  it("将旧版 success Admonition 经当前 HTML 回存为 canonical Markdown", () => {
    const instance = createEditor(
      '<div class="md-editor-admonition md-editor-admonition-success"><div class="md-editor-admonition-title">旧标题</div><p>旧正文</p></div>',
    );
    const serializedHtml = instance.getHTML();
    const output = document.createElement("div");
    output.innerHTML = serializedHtml;
    expect(output.querySelector("div.admonition.success > .admonition-title + .admonition-body")).not.toBeNull();

    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    registerCustomRules(turndown);

    expect(turndown.turndown(serializedHtml)).toBe("!!!success 旧标题\n旧正文\n!!!");
  });
});
