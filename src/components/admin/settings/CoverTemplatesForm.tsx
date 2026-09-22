"use client";

import { useEffect, useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Plus, Trash2, LayoutTemplate } from "lucide-react";
import { FormInput } from "@/components/ui/form-input";
import { FormSwitch } from "@/components/ui/form-switch";
import { FormTextarea } from "@/components/ui/form-textarea";
import { SettingsSection } from "./SettingsSection";
import { KEY_AI_COVER_TEMPLATES } from "@/lib/settings/setting-keys";
import {
  DATA_PLACEHOLDERS,
  CREATIVE_PLACEHOLDER_SUGGESTIONS,
  type DataPlaceholder,
} from "@/constants/cover-placeholders";
import {
  parseCustomTemplates,
  serializeCustomTemplates,
  genTemplateId,
  type CustomCoverTemplate,
} from "@/constants/cover-templates";

interface CoverTemplatesFormProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

const TEMPLATE_MAX_LENGTH = 6000;

// 展示用列表项：payload 基础上补充展开编辑态
interface EditableTemplate extends CustomCoverTemplate {
  expanded: boolean;
}

function parseFromValues(raw: string | undefined): EditableTemplate[] {
  return parseCustomTemplates(raw).map(t => ({ ...t, expanded: false }));
}

/** AI 封面自定义模板管理：与官方预设（constants/cover-templates.ts）互补，存 settings key ai_cover_templates */
export function CoverTemplatesForm({ values, onChange }: CoverTemplatesFormProps) {
  const [templates, setTemplates] = useState<EditableTemplate[]>(() => parseFromValues(values[KEY_AI_COVER_TEMPLATES]));

  useEffect(() => {
    onChange(KEY_AI_COVER_TEMPLATES, serializeCustomTemplates(templates));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  const update = (index: number, patch: Partial<EditableTemplate>) => {
    setTemplates(prev => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  // 设为默认是单选语义：选中某个时清除其他默认标记
  const setDefault = (index: number) => {
    setTemplates(prev => prev.map((t, i) => ({ ...t, is_default: i === index })));
  };

  const remove = (index: number) => {
    setTemplates(prev => prev.filter((_, i) => i !== index));
  };

  const add = () => {
    setTemplates(prev => [
      ...prev,
      {
        id: genTemplateId(),
        name: "",
        description: "",
        template: "",
        enabled: true,
        is_default: false,
        expanded: true,
      },
    ]);
  };

  return (
    <SettingsSection
      title="AI 封面模板"
      description="自定义一键 AI 配图的提示词模板，与官方预设一起出现在文章编辑器的封面生成弹窗中。模板支持占位符：{{ARTICLE_TITLE}} 等数据字段由系统自动填充，其余 {{...}} 由文本模型依文章信息填充。"
    >
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
        <p className="text-xs font-medium text-foreground/80">占位符（点击插入到当前编辑的模板末尾）</p>
        <div className="flex flex-wrap gap-1.5">
          {DATA_PLACEHOLDERS.map(p => (
            <PlaceholderChip key={p.key} ph={p} onPick={key => insertPlaceholderIntoExpanded(templates, setTemplates, key)} />
          ))}
          {CREATIVE_PLACEHOLDER_SUGGESTIONS.map(p => (
            <PlaceholderChip key={p.key} ph={p} onPick={key => insertPlaceholderIntoExpanded(templates, setTemplates, key)} />
          ))}
        </div>
        <p className="text-xs text-foreground/60">
          数据占位符生成时自动替换；其余 {"{{...}}"} 由文本模型参考文章信息创意填充（会多消耗一次文本模型调用）。
        </p>
      </div>

      <div className="space-y-4">
        {templates.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-8 text-center">
            <LayoutTemplate className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无自定义模板，可点击下方按钮新增；仅使用官方预设也无需配置。</p>
          </div>
        )}

        {templates.map((t, i) => (
          <div key={t.id} className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground/80">{t.name?.trim() || `模板 ${i + 1}`}</span>
              <div className="flex items-center gap-3">
                <FormSwitch label="启用" checked={t.enabled} onCheckedChange={v => update(i, { enabled: v })} />
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  color="danger"
                  onPress={() => remove(i)}
                  aria-label="删除该模板"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <FormInput
                label="模板名称"
                placeholder="如：极简杂志风"
                value={t.name}
                onValueChange={v => update(i, { name: v })}
              />
              <FormInput
                label="一句话描述"
                placeholder="显示在弹窗模板卡片上"
                value={t.description ?? ""}
                onValueChange={v => update(i, { description: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant={t.is_default ? "flat" : "bordered"}
                color={t.is_default ? "primary" : "default"}
                onPress={() => setDefault(i)}
              >
                {t.is_default ? "默认模板" : "设为默认"}
              </Button>
              <Button
                size="sm"
                variant="light"
                onPress={() => update(i, { expanded: !t.expanded })}
              >
                {t.expanded ? "收起模板内容" : "编辑模板内容"}
              </Button>
            </div>

            {t.expanded && (
              <FormTextarea
                label="提示词模板"
                placeholder={"生成一张现代科技博客文章封面…\n核心文字：{{KEYWORDS}}"}
                value={t.template}
                onValueChange={v => update(i, { template: v })}
                minRows={8}
                maxRows={20}
                maxLength={TEMPLATE_MAX_LENGTH}
                description={`使用 {{占位符}} 引用文章信息或留给 AI 创意填充，可从上方点击插入。当前 ${t.template.length}/${TEMPLATE_MAX_LENGTH} 字`}
              />
            )}
          </div>
        ))}
      </div>

      <Button color="primary" variant="flat" startContent={<Plus className="h-4 w-4" />} onPress={add}>
        新增封面模板
      </Button>
    </SettingsSection>
  );
}

function PlaceholderChip({ ph, onPick }: { ph: DataPlaceholder; onPick: (key: string) => void }) {
  return (
    <button type="button" onClick={() => onPick(ph.key)} title={ph.description} className="cursor-pointer">
      <Chip size="sm" variant="bordered" color="primary" className="hover:bg-primary/10">
        {`{{${ph.key}}}`}
      </Chip>
    </button>
  );
}

// 占位符插入目标：当前展开编辑中的模板；无展开项时不做任何插入
function insertPlaceholderIntoExpanded(
  templates: EditableTemplate[],
  setTemplates: React.Dispatch<React.SetStateAction<EditableTemplate[]>>,
  key: string
) {
  const idx = templates.findIndex(t => t.expanded);
  if (idx < 0) return;
  setTemplates(prev =>
    prev.map((t, i) => {
      if (i !== idx) return t;
      const snippet = `{{${key}}}`;
      return { ...t, template: t.template ? `${t.template}\n${snippet}` : snippet };
    })
  );
}
