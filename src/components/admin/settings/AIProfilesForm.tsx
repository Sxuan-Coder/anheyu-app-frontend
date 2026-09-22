"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { Plus, Trash2, Wand2, ImageIcon, Sparkles } from "lucide-react";
import { FormInput } from "@/components/ui/form-input";
import { FormSwitch } from "@/components/ui/form-switch";
import { SettingsSection } from "./SettingsSection";
import { CoverTemplatesForm } from "./CoverTemplatesForm";
import { Spinner } from "@/components/ui/spinner";
import { KEY_AI_PROFILES } from "@/lib/settings/setting-keys";

interface AIProfilesFormProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  loading?: boolean;
}

// ====== 与后端 ai_profiles JSON 结构对齐 ======
type Purpose = "summary" | "image";

interface ProfilePayload {
  id?: string;
  name?: string;
  provider?: string;
  api_url?: string;
  model?: string;
  enabled?: boolean;
  purpose?: string;
  api_key?: string;
  api_key_masked?: string;
  has_api_key?: boolean;
  /** 配图水印：false = 显式传 watermark=false 请求无水印；undefined = 不传（服务商默认） */
  watermark?: boolean;
  /** 生图返回格式（url / b64_json）；空 = 不传该参数，由服务商决定默认格式 */
  response_format?: string;
}

// 编辑态：在 payload 基础上增加 apiKeyInput（用户本次输入的新 Key）
interface EditableProfile extends ProfilePayload {
  apiKeyInput: string;
}

const PURPOSE_OPTIONS: { value: Purpose; label: string; icon: typeof Wand2; hint: string }[] = [
  { value: "summary", label: "摘要", icon: Wand2, hint: "文本模型 · chat/completions" },
  { value: "image", label: "配图", icon: ImageIcon, hint: "图像模型 · images/generations" },
];

function genId(): string {
  return `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseProfiles(raw: string): EditableProfile[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  try {
    const arr = JSON.parse(trimmed) as ProfilePayload[];
    if (!Array.isArray(arr)) return [];
    return arr.map(p => ({
      id: p.id ?? genId(),
      name: p.name ?? "",
      provider: p.provider ?? "openai",
      api_url: p.api_url ?? "",
      model: p.model ?? "",
      enabled: !!p.enabled,
      purpose: p.purpose === "image" ? "image" : "summary",
      api_key_masked: p.api_key_masked ?? "",
      has_api_key: !!p.has_api_key,
      watermark: p.purpose === "image" && p.watermark === false ? false : undefined,
      response_format: p.response_format ?? "",
      apiKeyInput: "",
    }));
  } catch {
    return [];
  }
}

// 序列化为后端可接受的 JSON：保留掩码回传标记，仅当用户输入新值才写 api_key
function serializeProfiles(profiles: EditableProfile[]): string {
  const out: ProfilePayload[] = profiles.map(p => {
    const payload: ProfilePayload = {
      id: p.id,
      name: p.name?.trim() ?? "",
      provider: p.provider?.trim() || "openai",
      api_url: p.api_url?.trim() ?? "",
      model: p.model?.trim() ?? "",
      enabled: !!p.enabled,
      purpose: p.purpose ?? "summary",
    };
    const inputKey = p.apiKeyInput?.trim();
    if (inputKey) {
      payload.api_key = inputKey;
    } else if (p.has_api_key) {
      // 未修改 Key：回传掩码标记，由后端用已存的明文 Key 还原
      payload.has_api_key = true;
      payload.api_key_masked = p.api_key_masked ?? "";
    }
    // 无水印：显式传 watermark=false；关闭时不传该参数（沿用服务商默认）
    if (p.purpose === "image" && p.watermark === false) {
      payload.watermark = false;
    }
    const responseFormat = p.response_format?.trim();
    if (p.purpose === "image" && responseFormat) {
      payload.response_format = responseFormat;
    }
    return payload;
  });
  return JSON.stringify(out);
}

export function AIProfilesForm({ values, onChange, loading }: AIProfilesFormProps) {
  // 仅从初始 values 派生一次；reload 时组件因 key 重新挂载会重新初始化
  const [profiles, setProfiles] = useState<EditableProfile[]>(() => parseProfiles(values[KEY_AI_PROFILES]));

  // 本地变更同步回外层，供统一保存按钮提交
  useEffect(() => {
    onChange(KEY_AI_PROFILES, serializeProfiles(profiles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  const summaryCount = useMemo(() => profiles.filter(p => p.purpose === "summary" && p.enabled).length, [profiles]);
  const imageCount = useMemo(() => profiles.filter(p => p.purpose === "image" && p.enabled).length, [profiles]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }

  const update = (index: number, patch: Partial<EditableProfile>) => {
    setProfiles(prev => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const remove = (index: number) => {
    setProfiles(prev => prev.filter((_, i) => i !== index));
  };

  const add = () => {
    setProfiles(prev => [
      ...prev,
      {
        id: genId(),
        name: "",
        provider: "openai",
        api_url: "",
        model: "",
        enabled: true,
        purpose: prev.length === 0 ? "summary" : "summary",
        api_key_masked: "",
        has_api_key: false,
        apiKeyInput: "",
      },
    ]);
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title="AI 模型配置"
        description="配置 OpenAI 兼容格式的大模型，用于文章 AI 摘要与一键 AI 配图。每个模型可指定用途（purpose）：摘要走 chat/completions，配图走 images/generations。支持 gpt-image-1、Gemini nano-banana 等经兼容网关的模型。"
      >
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
          <p className="text-xs font-medium text-foreground/80">使用说明</p>
          <ul className="space-y-1 text-xs leading-relaxed text-foreground/70 list-disc pl-4">
            <li>
              <b>Base URL</b>：填 OpenAI 兼容根地址（如 <code>https://api.openai.com/v1</code>），代码会自动拼接
              <code>/chat/completions</code> 或 <code>/images/generations</code>；也可直接填完整端点。
            </li>
            <li>
              <b>用途 purpose</b>：摘要对应文本模型，配图对应图像生成模型，按需分别添加。
            </li>
            <li>
              <b>API Key</b>：保存后端会脱敏存储；未修改时留空即可，不会覆盖已存的 Key。
            </li>
          </ul>
          <div className="flex gap-4 pt-1 text-xs text-foreground/60">
            <span>已启用摘要模型：<b className="text-foreground/80">{summaryCount}</b></span>
            <span>已启用配图模型：<b className="text-foreground/80">{imageCount}</b></span>
          </div>
        </div>

        <div className="space-y-4">
          {profiles.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-8 text-center">
              <Sparkles className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">尚未配置任何 AI 模型，点击下方按钮新增。</p>
            </div>
          )}

          {profiles.map((p, i) => (
            <div key={p.id} className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground/80">
                  {p.name?.trim() || `模型 ${i + 1}`}
                </span>
                <div className="flex items-center gap-3">
                  <FormSwitch
                    label="启用"
                    checked={!!p.enabled}
                    onCheckedChange={v => update(i, { enabled: v })}
                  />
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    color="danger"
                    onPress={() => remove(i)}
                    aria-label="删除该模型"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormInput
                  label="名称"
                  placeholder="如：默认摘要模型"
                  value={p.name ?? ""}
                  onValueChange={v => update(i, { name: v })}
                />
                <FormInput
                  label="Provider"
                  placeholder="openai / gemini / glm / custom"
                  value={p.provider ?? ""}
                  onValueChange={v => update(i, { provider: v })}
                  description="仅用于标识，不影响调用逻辑。"
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground/70">用途 purpose</span>
                <div className="flex gap-2">
                  {PURPOSE_OPTIONS.map(opt => {
                    const active = (p.purpose ?? "summary") === opt.value;
                    const Icon = opt.icon;
                    return (
                      <Button
                        key={opt.value}
                        size="sm"
                        variant={active ? "flat" : "bordered"}
                        color={active ? "primary" : "default"}
                        startContent={<Icon className="h-3.5 w-3.5" />}
                        onPress={() => update(i, { purpose: opt.value })}
                      >
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {PURPOSE_OPTIONS.find(o => o.value === (p.purpose ?? "summary"))?.hint}
                </p>
                {(p.purpose ?? "summary") === "image" && (
                  <>
                    <div className="pt-1">
                      <FormSwitch
                        label="无水印生成"
                        checked={p.watermark === false}
                        onCheckedChange={v => update(i, { watermark: v ? false : undefined })}
                        description="开启后生图请求显式携带 watermark=false 去除水印（如 SenseNova U1 Fast 默认带水印，去水印限时免费，后续或转为付费）。关闭时不传该参数，沿用服务商默认。"
                      />
                    </div>
                    <div className="pt-1">
                      <FormInput
                        label="返回格式 response_format"
                        placeholder="留空由服务商默认（url / b64_json）"
                        value={p.response_format ?? ""}
                        onValueChange={v => update(i, { response_format: v })}
                        description="部分中转站仅支持 url，传 b64_json 会被拒绝（400）；仅服务商标注的格式与默认不符时才需要填写。"
                      />
                    </div>
                  </>
                )}
              </div>

              <FormInput
                label="Base URL / 接口地址"
                placeholder="https://api.openai.com/v1"
                value={p.api_url ?? ""}
                onValueChange={v => update(i, { api_url: v })}
              />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormInput
                  label="模型名"
                  placeholder="summary: gpt-4o-mini / image: gpt-image-1、nano-banana-2"
                  value={p.model ?? ""}
                  onValueChange={v => update(i, { model: v })}
                />
                <FormInput
                  label="API Key"
                  type="password"
                  placeholder={p.has_api_key ? `已配置（${p.api_key_masked || "••••"}），留空保持不变` : "请输入 API Key"}
                  value={p.apiKeyInput}
                  onValueChange={v => update(i, { apiKeyInput: v })}
                  description={p.has_api_key ? "已保存，留空不修改。" : "保存后将脱敏存储。"}
                />
              </div>
            </div>
          ))}
        </div>

        <Button
          color="primary"
          variant="flat"
          startContent={<Plus className="h-4 w-4" />}
          onPress={add}
        >
          新增模型配置
        </Button>

        <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground/70">
          提示：配置完成后，点击页面右下角“保存”按钮生效。文章编辑器中将出现「AI 摘要」「AI 配图」按钮。
        </div>
      </SettingsSection>

      <CoverTemplatesForm values={values} onChange={onChange} />
    </div>
  );
}
