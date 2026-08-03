import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { AxiosError, AxiosHeaders, isAxiosError } from "axios";
import { apiClient, axiosInstance, tokenManager } from "@/lib/api/client";

const getHeader = (config: AxiosRequestConfig, key: string): string | undefined => {
  const headers = AxiosHeaders.from(config.headers as unknown as AxiosHeaders | Record<string, string> | undefined);
  const value = headers.get(key);
  return typeof value === "string" ? value : undefined;
};

const createOkResponse = (config: AxiosRequestConfig): AxiosResponse => ({
  data: { code: 200, data: null, message: "ok" },
  status: 200,
  statusText: "OK",
  headers: {},
  config: config as InternalAxiosRequestConfig,
});

describe("api client token attachment", () => {
  const originalAdapter = axiosInstance.defaults.adapter;

  beforeEach(() => {
    tokenManager.setTokenGetter(() => "test-access-token");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    axiosInstance.defaults.adapter = originalAdapter;
    tokenManager.setTokenGetter(() => null);
  });

  it("GET /api/public 不应附带 Authorization", async () => {
    axiosInstance.defaults.adapter = async config => {
      expect(getHeader(config, "Authorization")).toBeUndefined();
      return createOkResponse(config);
    };

    await axiosInstance.get("/api/public/site-config");
  });

  it("POST /api/public 会附带 Authorization", async () => {
    axiosInstance.defaults.adapter = async config => {
      expect(getHeader(config, "Authorization")).toBe("Bearer test-access-token");
      return createOkResponse(config);
    };

    await axiosInstance.post("/api/public/comments", { content: "test" });
  });

  it("保留服务端错误的传输原因，供幂等重试判断 HTTP 状态", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    axiosInstance.defaults.adapter = async config => {
      const response: AxiosResponse = {
        data: { code: 500, message: "服务器内部错误" },
        status: 500,
        statusText: "Internal Server Error",
        headers: {},
        config,
      };
      throw new AxiosError("request failed", "ERR_BAD_RESPONSE", config, undefined, response);
    };

    let caught: unknown;
    try {
      await apiClient.get("/api/articles");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("服务器内部错误");
    expect(isAxiosError((caught as Error).cause)).toBe(true);
    expect(((caught as Error).cause as AxiosError).response?.status).toBe(500);
  });
});
