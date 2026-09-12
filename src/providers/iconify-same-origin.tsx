"use client";

/*
 * 将 @iconify/react 的运行时图标数据源指向本站后端代理（/api/iconify）。
 * api.iconify.design 在国内访问不稳定，此前首页要直连它 14 次。
 * 模块加载时即生效，早于任何 <Icon> 组件挂载发起请求；
 * 后端带 24h 缓存，失败时仍会由 @iconify 本身的 localStorage 缓存兜底。
 */
import { addAPIProvider } from "@iconify/react";

if (typeof window !== "undefined") {
  addAPIProvider("", {
    resources: [`${window.location.origin}/api/iconify`],
  });
}

/**
 * 空组件：仅负责把本模块引入客户端 bundle，在布局中挂载一次即可。
 */
export function IconifySameOriginSetup() {
  return null;
}
