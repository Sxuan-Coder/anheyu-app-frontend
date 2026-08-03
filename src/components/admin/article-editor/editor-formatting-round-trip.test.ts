import { Editor } from "@tiptap/core";
import Color from "@tiptap/extension-color";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import TurndownService from "turndown";
import { afterEach, describe, expect, it } from "vitest";
import { processHtmlForSave } from "@/lib/content-processor";
import { registerCustomRules } from "@/lib/turndown-rules";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("article editor formatting round trip", () => {
  it("preserves text color and alignment when saved HTML is reopened", () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        TextStyle,
        Color,
        TextAlign.configure({
          types: ["heading", "paragraph"],
        }),
        Table,
        TableRow,
        TableCell,
        TableHeader,
      ],
      content:
        '<h2 style="text-align: center"><strong><span style="color: #4259ef">居中彩色标题</span></strong></h2>' +
        '<p><strong><span style="color: #ff0000">红色正文</span></strong></p>' +
        '<table><tbody><tr><th>台词</th></tr><tr><td><span style="color: #ff0000">富人最多的了</span></td></tr></tbody></table>',
    });

    const savedHtml = processHtmlForSave(editor.getHTML());
    editor.commands.setContent(savedHtml);
    const reopenedHtml = editor.getHTML();

    expect(reopenedHtml).toContain("text-align: center");
    expect(reopenedHtml).toMatch(/style="color: [^"]+"/);
    expect(reopenedHtml).toContain("居中彩色标题");
    expect(reopenedHtml).toContain("红色正文");
  });

  it("preserves text color and alignment when reopening through the Markdown fallback", () => {
    editor = new Editor({
      extensions: [
        StarterKit,
        TextStyle,
        Color,
        TextAlign.configure({
          types: ["heading", "paragraph"],
        }),
        Table,
        TableRow,
        TableCell,
        TableHeader,
      ],
      content:
        '<h2 style="text-align: center"><strong><span style="color: #4259ef">居中彩色标题</span></strong></h2>' +
        '<p><strong><span style="color: #ff0000">红色正文</span></strong></p>' +
        '<table><tbody><tr><th>台词</th></tr><tr><td><span style="color: #ff0000">富人最多的了</span></td></tr></tbody></table>',
    });
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
    });
    registerCustomRules(turndown);

    const markdown = turndown.turndown(processHtmlForSave(editor.getHTML()));
    const fallbackHtml = marked.parse(markdown, { async: false }) as string;
    editor.commands.setContent(fallbackHtml);
    const reopenedHtml = editor.getHTML();

    expect(reopenedHtml).toContain("text-align: center");
    expect(reopenedHtml.match(/style="color: [^"]+"/g)).toHaveLength(3);
    expect(reopenedHtml.match(/<strong>/g)).toHaveLength(2);
    expect(reopenedHtml).toContain("富人最多的了");
  });
});
