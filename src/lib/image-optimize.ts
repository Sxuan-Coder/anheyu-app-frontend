/*
 * 站内图片直链（/api/f/、/f/）优化参数助手。
 *
 * 后端 image_style 支持 ?w=&fit=&fm=&q= 动态参数（需在后台存储策略中开启图片处理）：
 * 未开启时参数被忽略并回退原图，开启后按参数缩放/转码（无 libvips 时 webp 自动降级 jpg），
 * 样式产物带 7 天强缓存。列表页封面用它避免下载 1~2.5MB 的原图。
 */

export type CoverPreset = "thumb" | "medium" | "banner";

const PRESETS: Record<CoverPreset, string> = {
  // 侧边栏 / 搜索结果等小尺寸缩略图
  thumb: "w=480&fit=inside&fm=webp&q=75",
  // 列表卡片封面
  medium: "w=640&fit=inside&fm=webp&q=78",
  // 首页顶部横幅大图
  banner: "w=1280&fit=inside&fm=webp&q=80",
};

function isSiteFileUrl(rawUrl: string): boolean {
  try {
    const { pathname } = new URL(rawUrl, "https://anheyu.invalid");
    return pathname.startsWith("/api/f/") || pathname.startsWith("/f/");
  } catch {
    return false;
  }
}

/** 为站内文件直链追加优化参数；非站内直链原样返回 */
export function optimizedImageSrc(rawUrl: string | null | undefined, preset: CoverPreset = "medium"): string {
  if (!rawUrl) return "";
  if (!isSiteFileUrl(rawUrl)) return rawUrl;
  return rawUrl + (rawUrl.includes("?") ? "&" : "?") + PRESETS[preset];
}
