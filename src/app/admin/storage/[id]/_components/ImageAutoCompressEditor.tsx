"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Chip,
  Divider,
  Input,
  Select,
  SelectItem,
  Slider,
  Spinner,
  Switch,
  addToast,
} from "@heroui/react";
import { Save } from "lucide-react";

import { getErrorMessage } from "@/lib/api/client";
import {
  ImageStyleApiError,
  imageStyleApi,
  type AutoCompressConfig,
  type ImageProcessConfig,
  type ImageStyleFormat,
  type ImageStyleConfig,
  type PolicyImageStylesPayload,
  type ValidationFieldError,
} from "@/lib/api/image-style";

const DEFAULT_APPLY_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic"];

const FORMAT_OPTIONS: { key: ImageStyleFormat; label: string }[] = [
  { key: "original", label: "原格式" },
  { key: "webp", label: "WebP" },
  { key: "avif", label: "AVIF" },
  { key: "png", label: "PNG" },
  { key: "jpg", label: "JPEG" },
  { key: "heic", label: "HEIC" },
];

function newEmptyAutoCompress(): AutoCompressConfig {
  return {
    enabled: false,
    quality: 85,
    format: "original",
    auto_rotate: true,
  };
}

function newEmptyProcess(): ImageProcessConfig {
  return {
    enabled: false,
    apply_to_extensions: [],
    default_style: "",
    auto_compress: newEmptyAutoCompress(),
  };
}

function fieldErrorsFor(errors: ValidationFieldError[] | undefined, prefix: string): string[] {
  if (!errors) return [];
  return errors.filter(e => e.field === prefix || e.field.startsWith(prefix + ".")).map(e => e.message);
}

function parseExtInput(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map(s => s.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

function parseOptionalNumber(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface Props {
  policyId: string;
}

export default function ImageAutoCompressEditor({ policyId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [process, setProcess] = useState<ImageProcessConfig>(newEmptyProcess);
  const [styles, setStyles] = useState<ImageStyleConfig[]>([]);
  const [errors, setErrors] = useState<ValidationFieldError[] | undefined>(undefined);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await imageStyleApi.get(policyId);
      setProcess({
        enabled: data.image_process?.enabled ?? false,
        apply_to_extensions: data.image_process?.apply_to_extensions ?? [],
        default_style: data.image_process?.default_style ?? "",
        auto_compress: data.image_process?.auto_compress ?? newEmptyAutoCompress(),
      });
      setStyles(data.image_styles ?? []);
      setErrors(undefined);
    } catch (err) {
      addToast({ title: getErrorMessage(err), color: "danger" });
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const autoCompress = process.auto_compress ?? newEmptyAutoCompress();
  const extInput = useMemo(() => process.apply_to_extensions.join(","), [process.apply_to_extensions]);
  const extErrors = fieldErrorsFor(errors, "image_process.apply_to_extensions");
  const autoErrors = {
    format: fieldErrorsFor(errors, "image_process.auto_compress.format"),
    quality: fieldErrorsFor(errors, "image_process.auto_compress.quality"),
    maxWidth: fieldErrorsFor(errors, "image_process.auto_compress.max_width"),
    maxHeight: fieldErrorsFor(errors, "image_process.auto_compress.max_height"),
  };

  const updateAutoCompress = useCallback((mutator: (value: AutoCompressConfig) => AutoCompressConfig) => {
    setProcess(prev => ({
      ...prev,
      auto_compress: mutator(prev.auto_compress ?? newEmptyAutoCompress()),
    }));
  }, []);

  const toggleAutoCompress = useCallback((enabled: boolean) => {
    setProcess(prev => ({
      ...prev,
      enabled: enabled ? true : prev.enabled,
      apply_to_extensions:
        enabled && prev.apply_to_extensions.length === 0 ? [...DEFAULT_APPLY_EXTENSIONS] : prev.apply_to_extensions,
      auto_compress: {
        ...(prev.auto_compress ?? newEmptyAutoCompress()),
        enabled,
      },
    }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    const payload: PolicyImageStylesPayload = {
      image_process: process,
      image_styles: styles,
    };
    try {
      await imageStyleApi.put(policyId, payload);
      addToast({ title: "自动压缩配置已保存", color: "success" });
      setErrors(undefined);
    } catch (err) {
      if (err instanceof ImageStyleApiError && err.details) {
        setErrors(err.details);
        addToast({ title: "校验失败，请检查红色提示", color: "danger" });
      } else {
        addToast({ title: getErrorMessage(err), color: "danger" });
      }
    } finally {
      setSaving(false);
    }
  }, [policyId, process, styles]);

  if (loading) {
    return (
      <div className="bg-card border border-border/50 rounded-xl p-8 flex items-center justify-center">
        <Spinner size="lg" label="加载图片处理配置..." />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border/50 rounded-xl p-6 space-y-5">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">图片自动压缩</h2>
          <Chip size="sm" variant="flat" color={autoCompress.enabled ? "success" : "default"}>
            {autoCompress.enabled ? "已启用" : "未启用"}
          </Chip>
        </div>
        <p className="text-xs text-muted-foreground">
          对没有命名样式、动态参数和默认样式命中的本地图片直链进行读取时压缩。
        </p>
      </header>

      <div className="flex items-center gap-4">
        <Switch isSelected={autoCompress.enabled} onValueChange={toggleAutoCompress}>
          无样式访问自动压缩
        </Switch>
        <Switch
          size="sm"
          isSelected={process.enabled}
          onValueChange={enabled =>
            setProcess(prev => ({
              ...prev,
              enabled,
              apply_to_extensions:
                enabled && prev.apply_to_extensions.length === 0 ? [...DEFAULT_APPLY_EXTENSIONS] : prev.apply_to_extensions,
            }))
          }
        >
          启用图片处理
        </Switch>
      </div>

      <Input
        label="生效扩展名"
        labelPlacement="outside"
        size="sm"
        placeholder="jpg, jpeg, png, webp, heic"
        value={extInput}
        onValueChange={raw => setProcess(prev => ({ ...prev, apply_to_extensions: parseExtInput(raw) }))}
        description="逗号或空格分隔。自动压缩只处理这些扩展名"
        isInvalid={extErrors.length > 0}
        errorMessage={extErrors.join("；")}
        endContent={
          <Button
            size="sm"
            variant="light"
            onPress={() => setProcess(prev => ({ ...prev, apply_to_extensions: [...DEFAULT_APPLY_EXTENSIONS] }))}
          >
            填入默认
          </Button>
        }
      />

      <Divider />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="输出格式"
          labelPlacement="outside"
          size="sm"
          selectedKeys={[autoCompress.format ?? "original"]}
          onSelectionChange={keys => {
            const format = Array.from(keys)[0] as ImageStyleFormat;
            updateAutoCompress(value => ({ ...value, format }));
          }}
          isInvalid={autoErrors.format.length > 0}
          errorMessage={autoErrors.format.join("；")}
        >
          {FORMAT_OPTIONS.map(option => (
            <SelectItem key={option.key}>{option.label}</SelectItem>
          ))}
        </Select>

        <div>
          <label className="text-xs font-medium mb-1.5 block">输出质量（{autoCompress.quality ?? 85}）</label>
          <Slider
            size="sm"
            step={1}
            minValue={1}
            maxValue={100}
            value={autoCompress.quality ?? 85}
            onChange={value =>
              updateAutoCompress(current => ({
                ...current,
                quality: Array.isArray(value) ? value[0] : value,
              }))
            }
            aria-label="auto compress quality"
          />
          {autoErrors.quality.length > 0 && <p className="text-danger text-xs mt-1">{autoErrors.quality.join("；")}</p>}
        </div>

        <Input
          label="最大宽度"
          labelPlacement="outside"
          size="sm"
          type="number"
          min={0}
          placeholder="不限制"
          value={autoCompress.max_width?.toString() ?? ""}
          onValueChange={value =>
            updateAutoCompress(current => ({ ...current, max_width: parseOptionalNumber(value) }))
          }
          isInvalid={autoErrors.maxWidth.length > 0}
          errorMessage={autoErrors.maxWidth.join("；")}
        />

        <Input
          label="最大高度"
          labelPlacement="outside"
          size="sm"
          type="number"
          min={0}
          placeholder="不限制"
          value={autoCompress.max_height?.toString() ?? ""}
          onValueChange={value =>
            updateAutoCompress(current => ({ ...current, max_height: parseOptionalNumber(value) }))
          }
          isInvalid={autoErrors.maxHeight.length > 0}
          errorMessage={autoErrors.maxHeight.join("；")}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <Switch
          size="sm"
          isSelected={autoCompress.auto_rotate ?? true}
          onValueChange={value => updateAutoCompress(current => ({ ...current, auto_rotate: value }))}
        >
          自动按 EXIF 旋转
        </Switch>

        <Button
          color="primary"
          size="sm"
          startContent={<Save className="w-3.5 h-3.5" />}
          onPress={save}
          isLoading={saving}
        >
          保存自动压缩
        </Button>
      </div>
    </div>
  );
}
