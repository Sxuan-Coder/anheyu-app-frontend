import type { Editor } from "@tiptap/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { vi, describe, expect, it } from "vitest";
import { EditorToolbar } from "./EditorToolbar";

vi.mock("@heroui/react", () => {
  function containsText(node: unknown, text: string): boolean {
    if (typeof node === "string") return node.includes(text);
    if (Array.isArray(node)) return node.some(child => containsText(child, text));
    if (!node || typeof node !== "object") return false;

    const element = node as { props?: { children?: unknown } };
    return containsText(element.props?.children, text);
  }

  return {
    Tooltip: ({ children, content }: { children: React.ReactNode; content: string }) => (
      <div data-tooltip={content}>{children}</div>
    ),
    Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    PopoverContent: ({ children }: { children: React.ReactNode }) =>
      containsText(children, "注释框") ? <>{children}</> : null,
  };
});

vi.mock("./MathFormulaDialog", () => ({ MathFormulaDialog: () => null }));
vi.mock("./EditorDialogs", () => ({ LinkDialog: () => null, ImageDialog: () => null }));

function createEditorMock(commands: Record<string, (...args: unknown[]) => boolean>) {
  const chain = {
    focus: () => chain,
    undo: () => chain,
    redo: () => chain,
    run: vi.fn(),
  };

  return {
    commands,
    chain: vi.fn(() => chain),
    can: vi.fn(() => ({ undo: () => false, redo: () => false })),
    getAttributes: vi.fn(() => ({})),
    isActive: vi.fn(() => false),
    on: vi.fn(),
    off: vi.fn(),
    view: { dom: document.createElement("div") },
  } as unknown as Editor;
}

describe("EditorToolbar 插入内容块", () => {
  it("显示注释框并插入默认 note Admonition", () => {
    const insertAdmonition = vi.fn(() => true);
    const editor = createEditorMock({ insertAdmonition });

    render(<EditorToolbar editor={editor} />);

    expect(screen.getByRole("button", { name: "注释框" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "注释框" }));

    expect(insertAdmonition).toHaveBeenCalledWith("note");
  });

  it("保留提示块插入 Callout 的语义", () => {
    const insertAdmonition = vi.fn(() => true);
    const insertCallout = vi.fn(() => true);
    const editor = createEditorMock({ insertAdmonition, insertCallout });

    render(<EditorToolbar editor={editor} />);
    fireEvent.click(screen.getByRole("button", { name: "提示块" }));

    expect(insertCallout).toHaveBeenCalledOnce();
    expect(insertAdmonition).not.toHaveBeenCalled();
  });
});
