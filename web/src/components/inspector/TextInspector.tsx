import React, { useMemo } from 'react';
import type { SpatialCard } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption, isProviderMissing } from '../../engine/channelModels.ts';
import { TEXT_PRESETS, getTextPreset } from '../../engine/textPresets.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from '../cards/ProviderModelPicker.tsx';
import { Field, Section, Segmented } from '../ui/index.ts';

const PRESET_HINTS: Record<string, string> = {
  image_prompt: '把你的想法改写成适合生图模型的提示词。',
  video_prompt: '把你的想法改写成包含动作和运镜的视频提示词，保留 @图N 引用。',
  free: '直接和模型对话，不附加任何指令。',
};

interface Props {
  card: SpatialCard;
  update: (patch: Partial<SpatialCard>) => void;
  /** Title of the image a describe card came from, if it is still on the canvas. */
  derivedSourceTitle?: string;
}

export const TextInspector: React.FC<Props> = ({ card, update, derivedSourceTitle }) => {
  if (card.derivedFrom?.operation === 'describe') {
    return (
      <Section title="来源">
        <p className="text-xs text-slate-300 leading-relaxed">
          用 Midjourney 反推「{derivedSourceTitle ?? '已删除的卡片'}」的图片（服务商 {card.provider}，模型{' '}
          <span className="font-mono">{card.model}</span>），结果是 4 条候选提示词。
        </p>
      </Section>
    );
  }
  return <ChatSettings card={card} update={update} />;
};

const ChatSettings: React.FC<Props> = ({ card, update }) => {
  const channels = useChannels();
  const groups = useMemo(() => buildProviderGroups(channels, 'text'), [channels]);
  const provider = card.provider ?? groups[0]?.provider ?? 'openai';
  const preset = getTextPreset(card.textPreset);

  return (
    <>
      <Section title="用途">
        <Field label="让模型写" hint={PRESET_HINTS[preset.id]}>
          <Segmented
            accent="emerald"
            value={preset.id}
            onChange={(id) => update({ textPreset: id })}
            options={TEXT_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          />
        </Field>
      </Section>
      <Section title="模型">
        {groups.length > 0 ? (
          <ProviderModelPicker
            groups={groups}
            provider={provider}
          missing={isProviderMissing(channels, card.provider)}
            model={card.model}
            modelLabel={findModelOption(groups, provider, card.model)?.label ?? (card.model || '选择模型')}
            accent="emerald"
            onSelect={(opt) => update({ provider: opt.provider, model: opt.id })}
          />
        ) : (
          <p className="text-[11px] leading-relaxed text-amber-200">
            还没有可用的文本模型。打开右上角「设置」，给任一服务商填好 Key 并绑定对话模型。
          </p>
        )}
      </Section>
    </>
  );
};
