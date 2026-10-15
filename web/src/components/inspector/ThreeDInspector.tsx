import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import type { SpatialCard } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption, isProviderMissing } from '../../engine/channelModels.ts';
import { removeReferencePatch } from '../../engine/cardParams.ts';
import { cardCapability } from '../../engine/capability.ts';
import { NO_3D_MODELS_HINT, capViews, model3DPatch, setViewPatch, viewLabel, viewOf } from '../../engine/model3d.ts';
import { compileHeighliner3DPayload } from '../../engine/heighlinerCompiler.ts';
import { isHunyuan3D, promptGoesWithImages } from '../../engine/heighlinerRules.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from '../cards/ProviderModelPicker.tsx';
import { Section, inputClass } from '../ui/index.ts';
import { DevJson } from './DevJson.tsx';
import { CapabilitySections } from './CapabilityFields.tsx';

interface Props {
  card: SpatialCard;
  /** All cards, to name reference images and resolve their files in the JSON preview. */
  cards: SpatialCard[];
  update: (patch: Partial<SpatialCard>) => void;
  /** Prompt supplied by a linked text card, for the JSON preview. */
  linkedPromptText?: string;
}

export const ThreeDInspector: React.FC<Props> = ({ card, cards, update, linkedPromptText }) => {
  const channels = useChannels();
  const groups = useMemo(() => buildProviderGroups(channels, '3d'), [channels]);
  const refs = card.references ?? [];
  const cap = cardCapability(card);
  const views = cap ? capViews(cap) : [];
  const promptDropped = !!cap && refs.length > 0 && !!card.prompt.trim() && !promptGoesWithImages(cap, card.capOptions);

  return (
    <>
      <Section title="模型">
        {groups.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-amber-300/90">{NO_3D_MODELS_HINT}。3D 卡片只能用 Heighliner 服务商的 3D 模型。</p>
        ) : (
          <ProviderModelPicker
            groups={groups}
            provider={card.provider ?? groups[0].provider}
            missing={isProviderMissing(channels, card.provider)}
            model={card.model}
            modelLabel={(card.provider && findModelOption(groups, card.provider, card.model)?.label) || card.model || '选择 3D 模型'}
            accent="sky"
            onSelect={(opt) => update(model3DPatch(card, opt))}
          />
        )}
      </Section>

      {card.model && <CapabilitySections card={card} update={update} accent="sky" />}

      <Section title={`参考图 ${refs.length}/${views.length || '–'}`}>
        {refs.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-slate-500">
            从图片结果卡或上传的图片右侧的圆点拖线到这张卡片。第一张默认作为主图，之后可以给每张选视角，每个视角一张；主图和正面只能二选一，多视图需要其中一张。
          </p>
        ) : (
          <ul className="space-y-1">
            {refs.map((ref) => {
              const view = viewOf(ref);
              // A view the current model does not take stays listed, so the card shows what it holds.
              const options = views.includes(view) ? views : [view, ...views];
              return (
                <li key={ref.cardId} className="flex items-center gap-2 rounded-lg bg-canvas-bg border border-canvas-border px-2 py-1.5 text-xs">
                  <span className="flex-1 min-w-0 truncate text-slate-300">{cards.find((c) => c.id === ref.cardId)?.title ?? ref.label}</span>
                  <select
                    title="这张图展示的视角"
                    value={view}
                    onChange={(e) => update(setViewPatch(card, ref.cardId, e.target.value))}
                    className={`${inputClass} !w-20 !py-0.5 focus:border-sky-500`}
                  >
                    {options.map((v) => (
                      <option key={v} value={v} disabled={!views.includes(v)}>
                        {viewLabel(v)}
                      </option>
                    ))}
                  </select>
                  <button type="button" title="移除" onClick={() => update(removeReferencePatch(card, ref.cardId))} className="p-0.5 text-slate-500 hover:text-rose-400">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {promptDropped && (
          <p className="text-[11px] leading-relaxed text-amber-300/90">
            {card.model} 连了参考图时只按图片生成，提示词不会发送{isHunyuan3D(cap) ? '（草图 Sketch 模式除外）' : ''}。
          </p>
        )}
        {views.length > 0 && <p className="text-[11px] text-slate-500">可选视角：{views.map(viewLabel).join('、')}。选一个已被占用的视角时，两张图互换。</p>}
      </Section>

      <DevJson compile={() => compileHeighliner3DPayload(linkedPromptText ? { ...card, prompt: linkedPromptText } : card, cards)} />
    </>
  );
};
