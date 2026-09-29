import React from 'react';
import type { SpatialCard } from '../../types/canvas.ts';
import { compileCardImagePayload } from '../../engine/compiler.ts';
import { VIDEO_MODE_LABELS } from '../../engine/cardParams.ts';
import { TEXT_PRESETS } from '../../engine/textPresets.ts';
import { useChannels } from '../../services/channels.ts';
import { Section } from '../ui/index.ts';
import { DevJson } from './DevJson.tsx';

const PARAM_LABELS: Record<string, string> = {
  imageMode: '生成方式',
  sizeMode: '尺寸设定',
  imageTier: '清晰度',
  imageRatioPreset: '比例',
  customPixels: '像素',
  imageResolution: '清晰度',
  imageFormat: '文件格式',
  watermark: '水印',
  background: '背景',
  mode: '模式',
  resolution: '清晰度',
  duration: '时长',
  ratio: '比例',
  generateAudio: '生成音频',
  textPreset: '预设',
};

const REFERENCE_ROLE_LABELS: Record<string, string> = {
  first_frame: '首帧',
  last_frame: '尾帧',
  reference_image: '参考',
};

const VALUE_LABELS: Record<string, string> = {
  single: '单张',
  layer_decomp: '拆分图层',
  sequential: '连续分镜',
  tier: '清晰度 + 比例',
  custom_pixels: '自定义像素',
  opaque: '不透明',
  transparent: '透明',
  jpeg: 'JPEG',
  png: 'PNG',
  adaptive: '自适应',
  ...Object.fromEntries(Object.entries(VIDEO_MODE_LABELS).map(([mode, { label }]) => [mode, label])),
};

const formatValue = (key: string, v: string | number | boolean) => {
  if (typeof v === 'boolean') return v ? '开' : '关';
  if (key === 'duration') return v === -1 ? '自适应' : `${v}s`;
  if (key === 'textPreset') return TEXT_PRESETS.find((p) => p.id === v)?.label ?? String(v);
  return VALUE_LABELS[String(v)] ?? String(v);
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 text-[11px]">
    <span className="flex-shrink-0 text-slate-500">{label}</span>
    <span className="min-w-0 text-right font-mono text-slate-300 break-all select-text">{children}</span>
  </div>
);

/** What a result card was generated with: read-only, whatever its generation card says now. */
export const ResultSnapshotView: React.FC<{ card: SpatialCard }> = ({ card }) => {
  const channels = useChannels();
  const snapshot = card.snapshot;
  if (!snapshot) {
    return (
      <Section title="生成参数">
        <p className="text-[11px] text-slate-500">这张结果卡没有记录生成参数。</p>
      </Section>
    );
  }
  const isText = card.type === 'text';
  const providerName = channels.find((p) => p.id === snapshot.provider)?.name ?? snapshot.provider ?? '—';

  return (
    <>
      <Section title={isText ? '想法' : '提示词'}>
        <p className="rounded-xl bg-canvas-bg border border-canvas-border px-2.5 py-1.5 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap break-words select-text">
          {snapshot.prompt || <span className="text-slate-500">（空）</span>}
        </p>
      </Section>
      <Section title="生成参数">
        <Row label="服务商">{providerName}</Row>
        <Row label="模型">{snapshot.model}</Row>
        {Object.entries(snapshot.params).map(([key, value]) => (
          <Row key={key} label={PARAM_LABELS[key] ?? key}>
            {formatValue(key, value)}
          </Row>
        ))}
        {!isText && <Row label="Seed">{snapshot.seed === undefined || snapshot.seed === -1 ? '随机' : snapshot.seed}</Row>}
        <p className="text-[11px] leading-relaxed text-slate-500">生成时的参数，只读。要换参数请改生成卡后再生成。</p>
      </Section>
      {snapshot.references?.length ? (
        <Section title="参考图">
          {snapshot.references.map((ref) => (
            <Row key={ref.cardId} label={REFERENCE_ROLE_LABELS[ref.role] ?? ref.role}>
              @图{ref.tagIndex} {ref.label}
            </Row>
          ))}
        </Section>
      ) : null}
      <DevJson
        compile={() =>
          // Video payloads need the referenced cards' assets, which may be gone: show the raw snapshot.
          card.type !== 'image' ? snapshot : compileCardImagePayload({
            ...card,
            ...snapshot.params,
            prompt: snapshot.prompt,
            provider: snapshot.provider,
            model: snapshot.model,
            seedImage: snapshot.seed,
          })
        }
      />
    </>
  );
};
