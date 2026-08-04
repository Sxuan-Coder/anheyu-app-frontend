/*
 * @Description: 博客 AI Agent 助手（参考 blog.zhheo.com 左下角 AI 智能对话）
 * @Author: 安知鱼
 * @Date: 2026-08-04
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, X, Trash2, Maximize2, Minimize2, CornerDownLeft } from "lucide-react";
import { marked } from "marked";
import { aiAgentApi, type AIAgentAction } from "@/lib/api/ai-agent";
import { useAIAgentStore, type AIAssistantMessage } from "@/store/ai-agent-store";
import { useSiteConfigStore } from "@/store/site-config-store";
import { sanitizeCommentHtml } from "@/components/post/Comment/comment-utils";
import { cn } from "@/lib/utils";
import styles from "./styles/AIAssistant.module.css";

/**
 * 剥离文本中的 Emoji 表情符号（兜底，与后端 prompt 禁止 Emoji 形成双保险）。
 * 覆盖常见 Emoji 区段：表情/符号/旗帜、杂项符号、dingbats、变体选择符等。
 */
const EMOJI_REGEX =
  /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

function stripEmoji(text: string): string {
  if (!text) return "";
  return text.replace(EMOJI_REGEX, "").replace(/\s{2,}/g, " ").trim();
}

/** 把 Markdown 渲染为安全的 HTML（渲染前剥离 Emoji） */
function renderMarkdown(md: string): string {
  if (!md) return "";
  const cleaned = stripEmoji(md);
  const html = marked.parse(cleaned, { async: false }) as string;
  return sanitizeCommentHtml(html);
}

/** 提取当前页面描述（meta description） */
function extractPageDescription(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  return meta?.content || "";
}

/** 获取当前页面上下文 */
function getPageContext() {
  if (typeof window === "undefined") return undefined;
  return {
    path: window.location.pathname + window.location.search,
    title: document.title,
    description: extractPageDescription(),
  };
}

/** 从 axios 错误中提取后端返回的友好提示 */
function extractErrorMessage(err: unknown): string {
  const axiosErr = err as {
    response?: { status?: number; data?: { message?: string } };
  };
  const status = axiosErr.response?.status;
  const serverMsg = axiosErr.response?.data?.message;
  if (status === 429 || (serverMsg && serverMsg.includes("繁忙"))) {
    return "AI 服务繁忙，请稍后再试。你也可以先看看「热门文章」「友情链接」等快捷功能。";
  }
  if (status === 503 || (serverMsg && serverMsg.includes("未配置"))) {
    return "AI 模型尚未配置，请在后台设置中启用后再使用对话功能。";
  }
  return "抱歉，AI 服务暂时不可用，请稍后再试。你也可以先看看「热门文章」「友情链接」等快捷功能。";
}

export function AIAssistant() {
  const router = useRouter();
  const siteConfig = useSiteConfigStore(state => state.siteConfig);
  const musicConfig = siteConfig?.music as Record<string, unknown> | undefined;
  const playerConfig = musicConfig?.player as Record<string, unknown> | undefined;
  // 音乐胶囊启用时，AI 悬浮按钮上移避免重叠
  const isPlayerEnabled =
    playerConfig?.enable === true || playerConfig?.enable === "true";
  const launcherBottomOffset = isPlayerEnabled ? 74 : 20;

  const {
    isOpen,
    isWindowed,
    messages,
    isStreaming,
    quickPrompts,
    toggleOpen,
    toggleWindowed,
    clearMessages,
    setMessages,
    updateLastMessage,
    setStreaming,
    setQuickPrompts,
  } = useAIAgentStore();

  const [input, setInput] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isStreamingRef = useRef(false);

  // 同步 isStreaming 到 ref，避免回调中读到过期状态
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // 加载配置：判断 AI 是否启用
  useEffect(() => {
    let mounted = true;
    aiAgentApi
      .getConfig()
      .then(res => {
        if (!mounted) return;
        setIsEnabled(res.data.enabled);
        if (res.data.quick_prompts?.length) {
          setQuickPrompts(res.data.quick_prompts);
        }
      })
      .catch(() => {
        if (mounted) setIsEnabled(false);
      });
    return () => {
      mounted = false;
    };
  }, [setQuickPrompts]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isStreaming]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // 快捷键 Shift+C 打开/关闭
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "c" || e.key === "C") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // 避免在输入框内误触
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleOpen]);

  /** 发送消息 */
  const sendMessage = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (!content || isStreamingRef.current) return;

      const userMsg: AIAssistantMessage = { role: "user", content };
      const history: AIAssistantMessage[] = [...messages, userMsg];

      setMessages(history);
      setInput("");
      setStreaming(true);

      try {
        const res = await aiAgentApi.chat({
          messages: history.map(m => ({ role: m.role, content: m.content })),
          page: getPageContext(),
        });
        const reply = res.data?.reply || "";
        updateLastMessage(reply, res.data?.actions);
      } catch (err) {
        console.error("[AIAssistant] 对话失败:", err);
        updateLastMessage(extractErrorMessage(err), []);
      } finally {
        setStreaming(false);
      }
    },
    [messages, setMessages, setStreaming, updateLastMessage]
  );

  /** 点击快捷提示 */
  const handleQuickPrompt = (prompt: string) => {
    void sendMessage(prompt);
  };

  /** 执行导航动作 */
  const handleAction = (action: AIAgentAction) => {
    if (!action.path) return;
    if (action.path.startsWith("http")) {
      window.open(action.path, "_blank", "noopener,noreferrer");
    } else {
      router.push(action.path);
      // 移动端跳转后收起面板
      if (window.innerWidth <= 768) toggleOpen(false);
    }
  };

  /** 回车发送（Shift+回车换行） */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  // AI 未启用时，显示可用的快捷入口（无 AI 对话）
  const renderFallbackQuickLinks = () => (
    <div className={styles.fallbackLinks}>
      {[
        { label: "全部文章", path: "/archives" },
        { label: "标签", path: "/tags" },
        { label: "分类", path: "/categories" },
        { label: "友情链接", path: "/link" },
        { label: "音乐馆", path: "/music" },
        { label: "关于", path: "/about" },
      ].map(link => (
        <button
          key={link.path}
          className={styles.quickChip}
          onClick={() => router.push(link.path)}
        >
          {link.label}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* 悬浮按钮（左下角） */}
      <div className={styles.launcherWrap} style={{ bottom: launcherBottomOffset }} data-open={isOpen ? "true" : undefined}>
        <motion.button
          className={styles.launcher}
          onClick={() => toggleOpen()}
          aria-label={isOpen ? "关闭 AI 智能对话" : "打开 AI 智能对话"}
          title="AI 智能对话（Shift + C）"
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
        >
          <motion.span
            className={styles.launcherIcon}
            animate={isOpen ? { rotate: 90, scale: 0 } : { rotate: 0, scale: 1 }}
            transition={{ duration: 0.18 }}
          >
            <Sparkles size={20} />
          </motion.span>
          <motion.span
            className={cn(styles.launcherIcon, styles.launcherIconClose)}
            animate={isOpen ? { rotate: 0, scale: 1 } : { rotate: -90, scale: 0 }}
            transition={{ duration: 0.18 }}
          >
            <X size={20} />
          </motion.span>
          <span className={styles.launcherPulse} aria-hidden="true" />
        </motion.button>
        {/* 展开提示气泡 */}
        <AnimatePresence>
          {!isOpen && (
            <motion.span
              className={styles.launcherLabel}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ delay: 0.15, duration: 0.2 }}
            >
              AI 智能对话
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* 对话面板 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className={cn(styles.panel, isWindowed && styles.panelWindowed)}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
          >
            {/* 头部 */}
            <div className={styles.panelHeader}>
              <div className={styles.headerTitle}>
                <span className={styles.headerIcon}>
                  <Sparkles size={15} />
                </span>
                <span>AI 智能对话</span>
                <span className={styles.headerMeta}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  在线
                </span>
              </div>
              <div className={styles.headerActions}>
                <button
                  className={styles.headerBtn}
                  onClick={() => toggleWindowed()}
                  title={isWindowed ? "退出窗口化" : "窗口化"}
                  aria-label={isWindowed ? "退出窗口化" : "窗口化"}
                >
                  {isWindowed ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button
                  className={styles.headerBtn}
                  onClick={clearMessages}
                  title="清空当前会话"
                  aria-label="清空当前会话"
                >
                  <Trash2 size={15} />
                </button>
                <button
                  className={styles.headerBtn}
                  onClick={() => toggleOpen(false)}
                  title="关闭"
                  aria-label="关闭"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* 消息区 */}
            <div className={styles.panelBody}>
              {messages.length === 0 ? (
                <div className={styles.welcome}>
                  <div className={styles.welcomeIcon}>
                    <Sparkles size={28} />
                  </div>
                  <p className={styles.welcomeTitle}>你好呀，我是本站 AI 助手</p>
                  <p className={styles.welcomeDesc}>
                    我可以帮你推荐热门文章、搜索内容、介绍博客，甚至可以带你跳转到感兴趣的页面～
                  </p>
                  <div className={styles.quickChips}>
                    {isEnabled ? (
                      quickPrompts.map(prompt => (
                        <button
                          key={prompt}
                          className={styles.quickChip}
                          onClick={() => handleQuickPrompt(prompt)}
                        >
                          {prompt}
                        </button>
                      ))
                    ) : (
                      renderFallbackQuickLinks()
                    )}
                  </div>
                </div>
              ) : (
                <div className={styles.messageList}>
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={cn(styles.messageRow, msg.role === "user" ? styles.userRow : styles.assistantRow)}
                    >
                      {msg.role === "assistant" && (
                        <span className={styles.avatar}>
                          <Sparkles size={13} />
                        </span>
                      )}
                      <div className={cn(styles.bubble, msg.role === "user" ? styles.userBubble : styles.assistantBubble)}>
                        {msg.role === "assistant" ? (
                          <div
                            className={styles.markdown}
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                          />
                        ) : (
                          <span className={styles.userText}>{msg.content}</span>
                        )}
                        {msg.role === "assistant" && msg.actions && msg.actions.length > 0 && (
                          <div className={styles.actions}>
                            {msg.actions.map((action, i) => (
                              <button
                                key={i}
                                className={styles.actionBtn}
                                onClick={() => handleAction(action)}
                              >
                                {action.label || "前往页面"} →
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {isStreaming && (
                    <div className={cn(styles.messageRow, styles.assistantRow)}>
                      <span className={styles.avatar}>
                        <Sparkles size={13} />
                      </span>
                      <div className={cn(styles.bubble, styles.assistantBubble, styles.typingBubble)}>
                        <span className={styles.typingDot} />
                        <span className={styles.typingDot} />
                        <span className={styles.typingDot} />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* 输入区 */}
            <div className={styles.panelFooter}>
              <div className={styles.inputWrap}>
                <textarea
                  ref={inputRef}
                  className={styles.input}
                  value={input}
                  placeholder={isEnabled ? "输入你想问的问题..." : "AI 未配置，可点击下方快捷入口"}
                  rows={1}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={!isEnabled}
                />
                <button
                  className={styles.sendBtn}
                  onClick={() => void sendMessage(input)}
                  disabled={!isEnabled || !input.trim() || isStreaming}
                  aria-label="发送"
                  title="发送（Enter）"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className={styles.disclaimer}>
                <CornerDownLeft size={11} className={styles.disclaimerIcon} />
                Enter 发送 · Shift + Enter 换行 · AI 可能生成不准确信息，请注意甄别
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}