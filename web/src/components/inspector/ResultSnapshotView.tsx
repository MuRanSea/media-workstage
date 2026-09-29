import React from 'react';
import type { SpatialCard } from '../../types/canvas.ts';
import { compileCardImagePayload } from '../../engine/compiler.ts';
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
};

const formatValue = (v: string | number | boolean) =>
  typeof v === 'boolean' ? (v ? '开' : '关') : VALUE_LABELS[String(v)] ?? String(v);

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
  const providerName = channels.find((p) => p.id === snapshot.provider)?.name ?? snapshot.provider ?? '—';

  return (
    <>
      <Section title="提示词">
        <p className="rounded-xl bg-canvas-bg border border-canvas-border px-2.5 py-1.5 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap break-words select-text">
          {snapshot.prompt || <span className="text-slate-500">（空）</span>}
        </p>
      </Section>
      <Section title="生成参数">
        <Row label="服务商">{providerName}</Row>
        <Row label="模型">{snapshot.model}</Row>
        {Object.entries(snapshot.params).map(([key, value]) => (
          <Row key={key} label={PARAM_LABELS[key] ?? key}>
            {formatValue(value)}
          </Row>
        ))}
        <Row label="Seed">{snapshot.seed ?? '随机'}</Row>
        <p className="text-[11px] leading-relaxed text-slate-500">生成时的参数，只读。要换参数请改生成卡后再生成。</p>
      </Section>
      <DevJson
        compile={() =>
          // Only image runs produce result cards so far; other types show the raw snapshot.
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
