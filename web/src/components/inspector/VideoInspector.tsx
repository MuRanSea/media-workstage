import React, { useMemo } from 'react';
import type { SpatialCard, VideoTaskMode } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption, isProviderMissing } from '../../engine/channelModels.ts';
import { protocolOf } from '../../engine/providers.ts';
import { VIDEO_MODE_LABELS, removeReferencePatch, videoModePatch, videoModelDef, videoModelPatch } from '../../engine/cardParams.ts';
import { compileCardVideoPayload, inferVideoProvider } from '../../engine/videoCompiler.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from '../cards/ProviderModelPicker.tsx';
import { Field, Section, Segmented, Toggle, inputClass } from '../ui/index.ts';
import { DevJson } from './DevJson.tsx';
import { ReferenceList } from './ReferenceList.tsx';

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
          missing={isProviderMissing(channels, card.provider)}
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
          <ReferenceList
            refs={refs}
            cards={cards}
            onRemove={(id) => update(removeReferencePatch(card, id))}
            emptyHint="从图片卡片右侧的圆点拖线到这张卡片，或在卡片上点「添加」。"
          />
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
