import { apiClient, axiosInstance } from "./client";

export type ImageStyleFormat = "original" | "webp" | "avif" | "png" | "jpg" | "heic";

export interface AutoCompressConfig {
  enabled: boolean;
  quality?: number;
  max_width?: number;
  max_height?: number;
  format?: ImageStyleFormat;
  auto_rotate?: boolean;
}

export interface ImageResizeConfig {
  mode: "cover" | "contain" | "fit-inside" | "scale";
  width?: number;
  height?: number;
  scale?: number;
  enlarge?: boolean;
}

export interface ImageStyleConfig {
  name: string;
  format?: ImageStyleFormat;
  quality?: number;
  auto_rotate?: boolean;
  resize: ImageResizeConfig;
}

export interface ImageProcessConfig {
  enabled: boolean;
  apply_to_extensions: string[];
  default_style: string;
  auto_compress?: AutoCompressConfig;
}

export interface PolicyImageStylesPayload {
  image_process: ImageProcessConfig;
  image_styles: ImageStyleConfig[];
}

export interface ValidationFieldError {
  field: string;
  message: string;
}

export class ImageStyleApiError extends Error {
  readonly details?: ValidationFieldError[];

  constructor(message: string, details?: ValidationFieldError[]) {
    super(message);
    this.name = "ImageStyleApiError";
    this.details = details;
  }
}

const policyStylesURL = (policyId: string): string =>
  `/api/policies/${encodeURIComponent(policyId)}/image-styles`;

export const imageStyleApi = {
  async get(policyId: string): Promise<PolicyImageStylesPayload> {
    const res = await apiClient.get<PolicyImageStylesPayload>(policyStylesURL(policyId));
    if (res.code !== 200 || !res.data) {
      throw new ImageStyleApiError(res.message || "读取图片处理配置失败");
    }
    return res.data;
  },

  async put(policyId: string, payload: PolicyImageStylesPayload): Promise<void> {
    try {
      await axiosInstance.put(policyStylesURL(policyId), payload);
    } catch (err) {
      const details = extractValidationDetails(err);
      if (details) {
        throw new ImageStyleApiError(deriveValidationMessage(err), details);
      }
      throw err;
    }
  },
};

interface ErrorWithResponse {
  response?: {
    data?: {
      message?: string;
      data?: unknown;
    };
  };
  message?: string;
}

function asErrorWithResponse(err: unknown): ErrorWithResponse {
  if (err && typeof err === "object") {
    return err as ErrorWithResponse;
  }
  return {};
}

function extractValidationDetails(err: unknown): ValidationFieldError[] | undefined {
  const data = asErrorWithResponse(err).response?.data?.data;
  if (!data || typeof data !== "object") return undefined;
  const errors = (data as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return undefined;
  return errors
    .filter(
      (e): e is ValidationFieldError =>
        !!e && typeof e === "object" && typeof (e as ValidationFieldError).field === "string",
    )
    .map(e => ({ field: e.field, message: e.message ?? "" }));
}

function deriveValidationMessage(err: unknown): string {
  const direct = asErrorWithResponse(err).response?.data?.message;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const fallback = asErrorWithResponse(err).message;
  if (typeof fallback === "string" && fallback.length > 0) return fallback;
  return "请求失败";
}
