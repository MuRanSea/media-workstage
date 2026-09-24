import React, { useMemo } from 'react';
import { IMAGE_MODELS, MJ_SPEED_LABELS, SEEDREAM_PIXEL_MAP, type MjSpeed, type SpatialCard } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption, isProviderMissing } from '../../engine/channelModels.ts';
import { protocolOf } from '../../engine/providers.ts';
import { imageModelPatch, removeReferencePatch } from '../../engine/cardParams.ts';
import { MJ_MAX_REFERENCES, MJ_MIN_BLEND_IMAGES } from '../../engine/connections.ts';
import { compileCardImagePayload } from '../../engine/compiler.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from '../cards/ProviderModelPicker.tsx';
import { Field, Section, Segmented, Toggle, inputClass } from '../ui/index.ts';
import { DevJson } from './DevJson.tsx';
import { ReferenceList } from './ReferenceList.tsx';

const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;
const RESOLUTIONS = ['1K', '2K', '4K'] as const;
const MJ_SPEEDS: { value: MjSpeed | 'default'; label: string }[] = [
  { value: 'default', label: '网关默认' },
  ...(Object.keys(MJ_SPEED_LABELS) as MjSpeed[]).map((s) => ({ value: s, label: MJ_SPEED_LABELS[s] })),
];

interface Props {
  card: SpatialCard;
  /** All cards, to name references and resolve their files in the JSON preview. */
  cards: SpatialCard[];
  update: (patch: Partial<SpatialCard>) => void;
  /** Prompt supplied by a linked text card, for the JSON preview. */
  linkedPromptText?: string;
  /** Title of the card a derived card came from, if it is still on the canvas. */
  derivedSourceTitle?: string;
}

export const ImageInspector: React.FC<Props> = ({ card, cards, update, linkedPromptText, derivedSourceTitle }) => {
  if (card.derivedFrom) {
    // A derived card runs its operation on the source's task with the source's settings.
    return (
      <>
        <Section title="来源">
          <p className="text-xs text-slate-300 leading-relaxed">
            对「{derivedSourceTitle ?? '已删除的卡片'}」的生成结果执行 <span className="font-mono text-violet-300">{card.derivedFrom.label}</span>，
            服务商、模型和尺寸沿用来源卡片。
          </p>
        </Section>
        <DevJson compile={() => compileCardImagePayload(card, cards)} />
      </>
    );
  }
  return <ImageSettings card={card} cards={cards} update={update} linkedPromptText={linkedPromptText} />;
};

const ImageSettings: React.FC<Props> = ({ card, cards, update, linkedPromptText }) => {
  const channels = useChannels();
  const groups = useMemo(() => buildProviderGroups(channels, 'image'), [channels]);
  const provider = card.provider ?? 'ark';
  const isSeedream = protocolOf(provider) === 'ark';
  const isMidjourney = protocolOf(provider) === 'midjourney';
  const def = IMAGE_MODELS.find((m) => m.id === card.model) ?? IMAGE_MODELS[0];
  const ratio = card.imageRatioPreset ?? '16:9';
  const tier = card.imageTier ?? def.defaultTier;
  const mode = card.imageMode ?? 'single';
  const ratioOptions = RATIOS.map((r) => ({ value: r, label: r }));

  return (
    <>
      <Section title="模型">
        <ProviderModelPicker
          groups={groups}
          provider={provider}
          missing={isProviderMissing(channels, card.provider)}
          model={card.model}
          modelLabel={(isSeedream ? IMAGE_MODELS.find((m) => m.id === card.model)?.name : undefined) ?? findModelOption(groups, provider, card.model)?.label ?? card.model}
          accent="pink"
          onSelect={(opt) => update(imageModelPatch(card, opt))}
        />
      </Section>

      <Section title={isMidjourney ? '比例与速度' : '尺寸'}>
        {isSeedream ? (
          <>
            <Field label="设定方式">
              <Segmented
                accent="pink"
                value={card.sizeMode ?? 'tier'}
                onChange={(v) =>
                  update(v === 'custom_pixels' ? { sizeMode: v, customPixels: card.customPixels || def.defaultCustomPixel } : { sizeMode: v })
                }
                options={[
                  { value: 'tier', label: '清晰度 + 比例' },
                  { value: 'custom_pixels', label: '自定义像素' },
                ]}
              />
            </Field>
            {card.sizeMode === 'custom_pixels' ? (
              <Field label="宽 x 高（像素）" aside={def.pixelRangeText}>
                <input
                  value={card.customPixels ?? def.defaultCustomPixel}
                  onChange={(e) => update({ customPixels: e.target.value })}
                  placeholder="例如 2048x1024"
                  className={`${inputClass} font-mono focus:border-pink-500`}
                />
              </Field>
            ) : (
              <>
                <Field label="清晰度">
                  <Segmented accent="pink" mono value={tier} onChange={(t) => update({ imageTier: t })} options={def.tiers.map((t) => ({ value: t, label: t }))} />
                </Field>
                <Field label="比例" aside={SEEDREAM_PIXEL_MAP[tier]?.[ratio] ?? ''}>
                  <Segmented accent="pink" mono columns={4} value={ratio} onChange={(r) => update({ imageRatioPreset: r })} options={ratioOptions} />
                </Field>
              </>
            )}
          </>
        ) : isMidjourney ? (
          <>
            <Field label="比例" hint="作为 --ar 加到提示词后面；提示词里自己写了 --ar 时以提示词为准。">
              <Segmented accent="pink" mono columns={4} value={ratio} onChange={(r) => update({ imageRatioPreset: r })} options={ratioOptions} />
            </Field>
            <Field label="速度" hint="选择代理里对应模式的账号；Relax 更省额度但要排队。提示词里自己写了 --fast / --relax / --turbo 时以提示词为准。">
              <Segmented
                accent="pink"
                value={card.mjSpeed ?? 'default'}
                onChange={(v) => update({ mjSpeed: v === 'default' ? undefined : v })}
                options={MJ_SPEEDS}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="清晰度">
              <Segmented accent="pink" mono value={card.imageResolution ?? '2K'} onChange={(r) => update({ imageResolution: r })} options={RESOLUTIONS.map((r) => ({ value: r, label: r }))} />
            </Field>
            <Field label="比例" hint="实际像素由模型决定；模型不支持清晰度档位时按它的默认尺寸出图。">
              <Segmented accent="pink" mono columns={4} value={ratio} onChange={(r) => update({ imageRatioPreset: r })} options={ratioOptions} />
            </Field>
          </>
        )}
      </Section>

      {isMidjourney && (
        <Section title={`参考图 ${card.references?.length ?? 0}/${MJ_MAX_REFERENCES}`}>
          <Field
            label="生成方式"
            hint={
              card.mjOperation === 'blend'
                ? `把连入的 ${MJ_MIN_BLEND_IMAGES}–${MJ_MAX_REFERENCES} 张图片混合成一张四宫格，不使用提示词；比例只分竖、方、横三种。`
                : '按提示词生成；连入的图片作为垫图。'
            }
          >
            <Segmented
              accent="pink"
              value={card.mjOperation ?? 'imagine'}
              onChange={(v) => update({ mjOperation: v === 'imagine' ? undefined : v })}
              options={[
                { value: 'imagine', label: '提示词生图' },
                {
                  value: 'blend',
                  label: 'Blend 混合',
                  disabled: (card.references?.length ?? 0) < MJ_MIN_BLEND_IMAGES && card.mjOperation !== 'blend',
                  title: `需要连入至少 ${MJ_MIN_BLEND_IMAGES} 张图片`,
                },
              ]}
            />
          </Field>
          <ReferenceList
            refs={card.references ?? []}
            cards={cards}
            onRemove={(id) => update(removeReferencePatch(card, id))}
            emptyHint="从其他图片卡片右侧的圆点拖线到这张卡片作为垫图（单张不超过 4MB）。"
          />
        </Section>
      )}

      {isSeedream && (
        <Section title="生成方式">
          <Field
            label="模式"
            hint={
              mode === 'layer_decomp'
                ? '输出一张底图和最多 16 个透明图层，可以把图层展开成单独的卡片。'
                : mode === 'sequential'
                  ? '一次生成最多 15 张连贯的分镜图。'
                  : '生成一张图片。'
            }
          >
            <Segmented
              accent="pink"
              value={mode}
              onChange={(m) => update({ imageMode: m })}
              options={[
                { value: 'single', label: '单张' },
                { value: 'layer_decomp', label: '拆分图层', disabled: !def.supportsLayerDecomp, title: def.supportsLayerDecomp ? undefined : '当前模型不支持' },
                { value: 'sequential', label: '连续分镜', disabled: !def.supportsSequential, title: def.supportsSequential ? undefined : '当前模型不支持' },
              ]}
            />
          </Field>
          <Field label="文件格式">
            <Segmented
              accent="pink"
              mono
              value={card.imageFormat ?? 'jpeg'}
              onChange={(f) => update({ imageFormat: f })}
              options={[
                { value: 'jpeg', label: 'JPEG' },
                { value: 'png', label: 'PNG' },
              ]}
            />
          </Field>
          <Toggle label="透明背景" hint="仅 PNG 有效" checked={card.background === 'transparent'} onChange={(v) => update({ background: v ? 'transparent' : 'opaque' })} />
          <Toggle label="添加水印" checked={!!card.watermark} onChange={(v) => update({ watermark: v })} />
        </Section>
      )}

      <DevJson
        compile={() => compileCardImagePayload(linkedPromptText ? { ...card, prompt: linkedPromptText } : card, cards)}
      />
    </>
  );
};
