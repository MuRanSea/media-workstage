import React, { useEffect, useState } from 'react';
import type { CapabilityParam } from '../../services/api.ts';
import type { CapValue, CapValues, SpatialCard } from '../../types/canvas.ts';
import {
  SPEC_LABELS,
  cardCapability,
  clampNumber,
  effectiveOptions,
  effectiveParams,
  optionGroups,
  rangeText,
  specFields,
  withOption,
  withValue,
  type CapField,
} from '../../engine/capability.ts';
import { ACCENT, Field, Section, Segmented, Toggle, inputClass, type Accent } from '../ui/index.ts';

/** Chinese names for vendor options the gateway's models commonly declare; others show their key. */
const OPTION_LABELS: Record<string, string> = {
  watermark: '水印',
  multi_shot: '多镜头',
  return_last_frame: '返回尾帧',
  enable_pbr: 'PBR 材质',
  enable_geometry: '只生成白模',
  generate_type: '生成类型',
  face_count: '面数',
  polygon_type: '多边形类型',
  pbr: 'PBR 材质',
  texture: '贴图',
  texture_quality: '贴图质量',
  geometry_quality: '几何质量',
  face_limit: '面数上限',
  auto_size: '自动尺寸',
  quad: '四边面',
  export_uv: '导出 UV',
};

const DEFAULT = '__default__';

function valueLabel(name: string, v: string | number): string {
  if (v === 'adaptive') return '自适应';
  if (name === 'duration' && typeof v === 'number') return v === -1 ? '自适应' : `${v}s`;
  return String(v);
}

/** A number typed freely, clamped into the range when the field is left or Enter is pressed. */
const NumberInput: React.FC<{
  param: CapabilityParam;
  value: CapValue | undefined;
  onChange: (value: number | undefined) => void;
  accent: Accent;
}> = ({ param, value, onChange, accent }) => {
  const shown = value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const n = clampNumber(param, text);
    setText(n === undefined ? '' : String(n));
    onChange(n);
  };
  return (
    <input
      type="number"
      value={text}
      min={param.minimum}
      max={param.maximum}
      step={param.type === 'integer' ? 1 : 'any'}
      placeholder={param.default !== undefined ? `默认 ${param.default}` : '留空由模型决定'}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className={`${inputClass} font-mono ${ACCENT[accent].focus}`}
    />
  );
};

/** One control for one descriptor field: switch, choice, number or text, by the field's type. */
const CapabilityControl: React.FC<{
  field: CapField;
  label: string;
  /** The option's full key (`kling.multi_shot`), shown beside vendor options. */
  keyName?: string;
  value: CapValue | undefined;
  onChange: (value: CapValue | undefined) => void;
  accent: Accent;
}> = ({ field: { name, param }, label, keyName, value, onChange, accent }) => {
  const hasDefault = param.default !== undefined;

  if (param.type === 'boolean') {
    if (hasDefault) return <Toggle label={label} hint={keyName} checked={value === true} onChange={onChange} />;
    // No default: leaving it unset lets the vendor decide.
    return (
      <Field label={label} aside={keyName}>
        <Segmented
          accent={accent}
          value={value === undefined ? DEFAULT : value ? 'on' : 'off'}
          onChange={(v) => onChange(v === DEFAULT ? undefined : v === 'on')}
          options={[
            { value: DEFAULT, label: '默认' },
            { value: 'on', label: '开' },
            { value: 'off', label: '关' },
          ]}
        />
      </Field>
    );
  }

  if (param.enum) {
    const items = param.enum.map((v) => ({ value: String(v), label: valueLabel(name, v) }));
    const options = hasDefault ? items : [{ value: DEFAULT, label: '默认' }, ...items];
    const current = value === undefined ? DEFAULT : String(value);
    const pick = (v: string) => onChange(v === DEFAULT ? undefined : param.enum!.find((e) => String(e) === v));
    return (
      <Field label={label} aside={keyName}>
        {options.length <= 8 ? (
          <Segmented accent={accent} mono columns={options.length > 4 ? 4 : undefined} value={current} onChange={pick} options={options} />
        ) : (
          <select value={current} onChange={(e) => pick(e.target.value)} className={`${inputClass} font-mono ${ACCENT[accent].focus}`}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  }

  if (param.type === 'integer' || param.type === 'number') {
    const range = rangeText(param);
    return (
      <Field label={label} aside={[keyName, range && `范围 ${range}`].filter(Boolean).join(' · ')}>
        <NumberInput param={param} value={value} onChange={onChange} accent={accent} />
      </Field>
    );
  }

  return (
    <Field label={label} aside={keyName}>
      <input
        value={typeof value === 'string' ? value : ''}
        maxLength={param.maxLength}
        placeholder={typeof param.default === 'string' ? `默认 ${param.default}` : '留空由模型决定'}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        className={`${inputClass} ${ACCENT[accent].focus}`}
      />
    </Field>
  );
};

interface Props {
  fields: CapField[];
  /** Current values, already fitted to the descriptor. */
  values: CapValues;
  onChange: (name: string, value: CapValue | undefined) => void;
  accent: Accent;
  /** Vendor namespace: labels show the option's full key. */
  namespace?: string;
}

/** Controls generated from a Heighliner model's capability descriptor (ADR 0010). */
export const CapabilityFields: React.FC<Props> = ({ fields, values, onChange, accent, namespace }) => (
  <>
    {fields.map((field) => (
      <CapabilityControl
        key={field.name}
        field={field}
        label={namespace ? OPTION_LABELS[field.name] ?? field.name : SPEC_LABELS[field.name] ?? field.name}
        keyName={namespace ? `${namespace}.${field.name}` : undefined}
        value={values[field.name]}
        onChange={(v) => onChange(field.name, v)}
        accent={accent}
      />
    ))}
  </>
);

/**
 * A Heighliner card's 规格 and 高级 sections: the common parameters its model declares,
 * then the vendor options by namespace. `ratioNote` replaces the ratio control when the
 * mode decides the shape (first/last frame).
 */
export const CapabilitySections: React.FC<{
  card: SpatialCard;
  update: (patch: Partial<SpatialCard>) => void;
  accent: Accent;
  ratioNote?: string;
}> = ({ card, update, accent, ratioNote }) => {
  const cap = cardCapability(card);
  if (!cap) {
    return (
      <Section title="规格">
        <p className="text-[11px] leading-relaxed text-amber-300/90">
          没有找到模型 {card.model} 的能力描述。请在设置里重新获取这个服务商的模型列表。
        </p>
      </Section>
    );
  }
  const values = effectiveParams(cap, card.capParams);
  const options = effectiveOptions(cap, card.capOptions);
  const spec = specFields(cap).filter((f) => !(ratioNote && f.name === 'aspect_ratio'));
  const groups = optionGroups(cap);
  return (
    <>
      <Section title="规格">
        {ratioNote && cap.parameters?.aspect_ratio && (
          <Field label={SPEC_LABELS.aspect_ratio}>
            <p className="text-xs text-slate-400">{ratioNote}</p>
          </Field>
        )}
        {spec.length === 0 && !ratioNote && <p className="text-[11px] text-slate-500">这个模型没有可调的通用参数。</p>}
        <CapabilityFields
          fields={spec}
          values={values}
          accent={accent}
          onChange={(name, v) => update({ capParams: withValue(values, name, v) })}
        />
      </Section>
      {groups.length > 0 && (
        <Section title="高级">
          {groups.map(({ ns, fields }) => (
            <CapabilityFields
              key={ns}
              namespace={ns}
              fields={fields}
              values={options[ns] ?? {}}
              accent={accent}
              onChange={(name, v) => update({ capOptions: withOption(options, ns, name, v) })}
            />
          ))}
          <p className="text-[11px] leading-relaxed text-slate-500">厂商自己的选项，原样放进 provider_options 发给网关；设为「默认」的不发送。</p>
        </Section>
      )}
    </>
  );
};
