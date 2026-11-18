import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { supportsVideoMode, takesVideoReferType, type SpatialCard, type VideoReferType, type VideoTaskMode } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption, isProviderMissing } from '../../engine/channelModels.ts';
import { protocolOf } from '../../engine/providers.ts';
import {
  VIDEO_MODE_LABELS,
  VIDEO_REFER_TYPE_LABELS,
  assetKindsFor,
  kindLimit,
  referenceCapacity,
  referenceCount,
  removeReferencePatch,
  supportsAssetRefs,
  videoModePatch,
  videoModelDef,
  videoModelPatch,
} from '../../engine/cardParams.ts';
import { compileCardVideoPayload, inferVideoProvider } from '../../engine/videoCompiler.ts';
import { refTag } from '../../engine/refTags.ts';
import { UPLOAD_REF_LABELS, uploadRefKind } from '../../engine/uploadRefs.ts';
import { isKling4 } from '../../engine/heighlinerRules.ts';
import { cardCapability, modeCapability, referenceSlot } from '../../engine/capability.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from '../cards/ProviderModelPicker.tsx';
import { Field, Section, Segmented, Toggle, inputClass } from '../ui/index.ts';
import { DevJson } from './DevJson.tsx';
import { AssetRefList } from './AssetRefList.tsx';
import { CapabilitySections } from './CapabilityFields.tsx';
import { SAMPLE_RESOLUTION, isSampleRun, supportsSample } from '../../engine/capability.ts';

const ROLE_LABELS: Record<string, string> = {
  first_frame: '首帧',
  last_frame: '尾帧',
  reference_image: '参考',
  reference_video: '参考视频',
  reference_audio: '参考音频',
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
  const isHeighliner = protocolOf(provider) === 'heighliner';
  const cap = cardCapability(card);
  const kling4 = isKling4(cap);
  const roleOptions = (type: 'image' | 'video') => (type === 'video'
    ? mode === 'video_edit' ? ['source', 'reference'] : ['reference']
    : mode === 'first_last_frame' ? ['first_frame', 'middle_frame', 'last_frame'] : ['reference', 'first_frame', 'middle_frame', 'last_frame']
  ).filter((role) => referenceSlot(modeCapability(cap, mode), role, type));
  const maxRefs = referenceCapacity(card, mode);
  const supports = (m: VideoTaskMode) => supportsVideoMode(def, m);
  // Kling Omni asks what its reference video is for; an edit keeps the video's length and shape. Neither has sound.
  const referType: VideoReferType | undefined =
    takesVideoReferType(protocolOf(provider), card.model) && mode === 'all_modal' && refs.some((r) => r.role === 'reference_video')
      ? card.videoReferType ?? 'base'
      : undefined;

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
            options={(Object.keys(VIDEO_MODE_LABELS) as VideoTaskMode[])
              // Video editing is offered only by the models that declare it.
              .filter((m) => m !== 'video_edit' || supports(m))
              .map((m) => ({
              value: m,
              label: VIDEO_MODE_LABELS[m].label,
              disabled: !supports(m),
              title: supports(m) ? undefined : '当前模型不支持',
            }))}
          />
        </Field>
        {referType && (
          <Field label="参考视频用途" hint={VIDEO_REFER_TYPE_LABELS[referType].hint}>
            <Segmented
              value={referType}
              onChange={(t) => update({ videoReferType: t })}
              options={(Object.keys(VIDEO_REFER_TYPE_LABELS) as VideoReferType[]).map((t) => ({ value: t, label: VIDEO_REFER_TYPE_LABELS[t].label }))}
            />
          </Field>
        )}
      </Section>

      {isHeighliner ? (
        <>
          {supportsSample(card) && (
            <Section title="样片">
              <Toggle
                label="样片模式"
                hint={`先出 ${SAMPLE_RESOLUTION} 样片确认画面，满意再在结果卡上选择 1080p 或 4K 正式视频`}
                checked={!!card.sampleMode}
                onChange={(v) => update({ sampleMode: v || undefined })}
              />
              {card.sampleMode && (
                <p className="text-[11px] leading-relaxed text-slate-500">
                  样片按提示词、参考素材、时长、比例和音频生成；正式视频沿用这些设置，不能再改。样片按厂商创建时间有效 7 或 14 天，样片和正式视频各自计费。
                </p>
              )}
            </Section>
          )}
          <CapabilitySections
            card={card}
            update={update}
            accent="indigo"
            ratioNote={mode === 'first_last_frame' ? '首尾帧模式下比例跟随首帧图片。' : undefined}
            locked={isSampleRun(card) ? { resolution: `${SAMPLE_RESOLUTION}（样片固定）` } : undefined}
          />
        </>
      ) : (
        <Section title="规格">
          <Field label="清晰度">
            <Segmented mono value={card.resolution ?? def.resolutions[0]} onChange={(r) => update({ resolution: r })} options={def.resolutions.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="时长">
            {referType === 'base' ? (
              <p className="text-xs text-slate-400">编辑视频时，时长跟随原视频。</p>
            ) : (
              <Segmented
                mono
                value={card.duration ?? def.durations[0]}
                onChange={(d) => update({ duration: d })}
                options={def.durations.map((d) => ({ value: d, label: d === -1 ? '自适应' : `${d}s` }))}
              />
            )}
          </Field>
          <Field label="比例">
            {mode === 'first_last_frame' ? (
              <p className="text-xs text-slate-400">首尾帧模式下比例跟随首帧图片。</p>
            ) : referType === 'base' ? (
              <p className="text-xs text-slate-400">编辑视频时，比例跟随原视频。</p>
            ) : (
              <Segmented mono columns={4} value={card.ratio ?? def.ratios[0]} onChange={(r) => update({ ratio: r })} options={def.ratios.map((r) => ({ value: r, label: r === 'adaptive' ? '自适应' : r }))} />
            )}
          </Field>
        </Section>
      )}

      {mode !== 'text_to_video' && (
        <Section title={`参考素材 ${refs.length}/${maxRefs}`}>
          {refs.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-slate-500">
              从图片或上传卡片右侧的圆点拖线到这张卡片，或在卡片上点「添加」。
            </p>
          ) : (
            <ul className="space-y-1">
              {refs.map((ref, index) => {
                const src = cards.find((c) => c.id === ref.cardId);
                const type = ref.role === 'reference_video' ? 'video' : 'image';
                const role = ref.view ?? (type === 'video' && mode === 'video_edit' && !refs.slice(0, index).some((r) => r.role === 'reference_video') ? 'source' : mode === 'first_last_frame' ? (index === 0 ? 'first_frame' : index === refs.length - 1 ? 'last_frame' : 'middle_frame') : 'reference');
                return (
                  <li key={ref.cardId} className="flex items-center gap-2 rounded-lg bg-canvas-bg border border-canvas-border px-2 py-1.5 text-xs">
                    <span className={`font-mono ${src?.type === 'upload' ? 'text-amber-300' : 'text-pink-300'}`}>{refTag(ref)}</span>
                    <span className="flex-1 min-w-0 truncate text-slate-300">{src?.title ?? ref.label}</span>
                    <span className="text-[11px] text-slate-500">
                      {kling4 && roleOptions(type).length > 1 ? <select aria-label={`设置 ${refTag(ref)} 的角色`} value={role} className="rounded bg-canvas-bg" onChange={(e) => {
                        const view = e.target.value;
                        const next = refs.map((r) => r.cardId === ref.cardId ? { ...r, view } : r);
                        update({ references: next });
                      }}>{roleOptions(type).map((r) => <option key={r} value={r}>{{ source: '源视频', reference: '参考', first_frame: '首帧', middle_frame: '中间帧', last_frame: '尾帧' }[r]}</option>)}</select> : mode === 'video_edit' && ref.role === 'reference_video' ? '待编辑视频' : ROLE_LABELS[ref.role] ?? ref.role}
                      {src?.type === 'upload' && (() => {
                        const sent = uploadRefKind(src, protocolOf(provider) ?? 'ark');
                        return sent ? ` · 发送${UPLOAD_REF_LABELS[sent]}` : ' · 未就绪';
                      })()}
                    </span>
                    {kling4 && index > 0 && <button type="button" title="向前移动素材" onClick={() => {
                      const reordered = [...refs];
                      [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
                      update({ references: reordered });
                    }}>↑</button>}
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

      {supportsAssetRefs(card) && mode === 'all_modal' && (
        <Section
          title={`素材库 ${(card.assetRefs ?? []).length}`}
        >
          <p className="text-[11px] leading-relaxed text-slate-500">
            图片 {referenceCount(card, 'image')}/{kindLimit(card, 'image', def)} · 视频 {referenceCount(card, 'video')}/{kindLimit(card, 'video', def)} · 音频{' '}
            {referenceCount(card, 'audio')}/{kindLimit(card, 'audio', def)}（含连入的卡片）
          </p>
          <AssetRefList card={card} update={update} kinds={assetKindsFor(card)} />
        </Section>
      )}

      {!isHeighliner && (
        <Section title="其他">
          {!referType && def.supportsAudio && <Toggle label="生成音频" checked={!!card.generateAudio} onChange={(v) => update({ generateAudio: v })} />}
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
      )}

      <DevJson compile={() => compileCardVideoPayload(linkedPromptText ? { ...card, prompt: linkedPromptText } : card, cards)} />
    </>
  );
};
