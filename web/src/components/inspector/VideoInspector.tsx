import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import type { SpatialCard, VideoTaskMode } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption } from '../../engine/channelModels.ts';
import { protocolOf } from '../../engine/providers.ts';
import { VIDEO_MODE_LABELS, removeReferencePatch, videoModePatch, videoModelDef, videoModelPatch } from '../../engine/cardParams.ts';
import { compileCardVideoPayload, inferVideoProvider } from '../../engine/videoCompiler.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from '../cards/ProviderModelPicker.tsx';
import { Field, Section, Segmented, Toggle, inputClass } from '../ui/index.ts';
import { DevJson } from './DevJson.tsx';

const ROLE_LABELS: Record<string, string> = {
  first_frame: '首帧',
  last_frame: '尾帧',
  reference_image: '参考',
};

interface Props {
  card: SpatialCard;
  cards: SpatialCard[];
  update: (patch: Partial<SpatialCard>) => void;
  linkedPromptText?: string;
}

export const VideoInspector: React.FC<Props> = ({ card, cards, update, linkedPromptText }) => {
  const channels = useChannels();
  const groups = useMemo(() => buildProviderGroups(channels, 'video'), [channels]);
  const provider = card.provider ?? inferVideoProvider(card.model);
  const def = videoModelDef(card);
  const mode = card.mode ?? 'all_modal';
  const refs = card.references ?? [];
  const maxRefs = mode === 'first_last_frame' ? Math.min(2, def.maxRefs) : def.maxRefs;
  const supports = (m: VideoTaskMode) => !def.modes || def.modes.includes(m);

  return (
    <>
      <Section title="模型">
        <ProviderModelPicker
          groups={groups}
          provider={provider}
          model={card.model}
          modelLabel={findModelOption(groups, provider, card.model)?.label ?? def.name}
          accent="indigo"
          onSelect={(opt) => update(videoModelPatch(card, opt))}
        />
      </Section>

      <Section title="生成方式">
        <Field label="模式" hint={VIDEO_MODE_LABELS[mode].hint}>
          <Segmented
            value={mode}
            onChange={(m) => update(videoModePatch(card, m, def.maxRefs))}
            options={(Object.keys(VIDEO_MODE_LABELS) as VideoTaskMode[]).map((m) => ({
              value: m,
              label: VIDEO_MODE_LABELS[m].label,
              disabled: !supports(m),
              title: supports(m) ? undefined : '当前模型不支持',
            }))}
          />
        </Field>
      </Section>

      <Section title="规格">
        <Field label="清晰度">
          <Segmented mono value={card.resolution ?? def.resolutions[0]} onChange={(r) => update({ resolution: r })} options={def.resolutions.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="时长">
          <Segmented
            mono
            value={card.duration ?? def.durations[0]}
            onChange={(d) => update({ duration: d })}
            options={def.durations.map((d) => ({ value: d, label: d === -1 ? '自适应' : `${d}s` }))}
          />
        </Field>
        <Field label="比例">
          {mode === 'first_last_frame' ? (
            <p className="text-xs text-slate-400">首尾帧模式下比例跟随首帧图片。</p>
          ) : (
            <Segmented mono columns={4} value={card.ratio ?? def.ratios[0]} onChange={(r) => update({ ratio: r })} options={def.ratios.map((r) => ({ value: r, label: r === 'adaptive' ? '自适应' : r }))} />
          )}
        </Field>
      </Section>

      {mode !== 'text_to_video' && (
        <Section title={`参考图 ${refs.length}/${maxRefs}`}>
          {refs.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-slate-500">
              从图片卡片右侧的圆点拖线到这张卡片，或在卡片上点「添加」。
            </p>
          ) : (
            <ul className="space-y-1">
              {refs.map((ref) => {
                const src = cards.find((c) => c.id === ref.cardId);
                return (
                  <li key={ref.cardId} className="flex items-center gap-2 rounded-lg bg-canvas-bg border border-canvas-border px-2 py-1.5 text-xs">
                    <span className="font-mono text-pink-300">@图{ref.tagIndex}</span>
                    <span className="flex-1 min-w-0 truncate text-slate-300">{src?.title ?? ref.label}</span>
                    <span className="text-[11px] text-slate-500">{ROLE_LABELS[ref.role] ?? ref.role}</span>
                    <button type="button" title="移除" onClick={() => update(removeReferencePatch(card, ref.cardId))} className="p-0.5 text-slate-500 hover:text-rose-400">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}

      <Section title="其他">
        {def.supportsAudio && <Toggle label="生成音频" checked={!!card.generateAudio} onChange={(v) => update({ generateAudio: v })} />}
        {protocolOf(provider) === 'minimax' && (
          <Toggle label="自动优化提示词" hint="由 MiniMax 改写提示词后再生成" checked={!!card.promptOptimizer} onChange={(v) => update({ promptOptimizer: v })} />
        )}
        {def.supportsMov && (
          <Field label="文件格式">
            <Segmented
              mono
              value={card.outputFormat ?? 'mp4'}
              onChange={(f) => update({ outputFormat: f })}
              options={[
                { value: 'mp4', label: 'MP4' },
                { value: 'mov', label: 'MOV' },
              ]}
            />
          </Field>
        )}
        <Field label="随机种子" hint="-1 表示每次随机；固定数值可以复现相近的结果。">
          <input
            type="number"
            value={card.seed ?? -1}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              update({ seed: Number.isNaN(n) ? -1 : n });
            }}
            className={`${inputClass} font-mono focus:border-indigo-500`}
          />
        </Field>
      </Section>

      <DevJson compile={() => compileCardVideoPayload(linkedPromptText ? { ...card, prompt: linkedPromptText } : card, cards)} />
    </>
  );
};
