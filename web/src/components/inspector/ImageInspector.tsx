import React, { useMemo } from 'react';
import { IMAGE_MODELS, SEEDREAM_PIXEL_MAP, type SpatialCard } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption } from '../../engine/channelModels.ts';
import { imageModelPatch } from '../../engine/cardParams.ts';
import { compileCardImagePayload } from '../../engine/compiler.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from '../cards/ProviderModelPicker.tsx';
import { Field, Section, Segmented, Toggle, inputClass } from '../ui/index.ts';
import { DevJson } from './DevJson.tsx';

const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;
const RESOLUTIONS = ['1K', '2K', '4K'] as const;

interface Props {
  card: SpatialCard;
  update: (patch: Partial<SpatialCard>) => void;
  /** Prompt supplied by a linked text card, for the JSON preview. */
  linkedPromptText?: string;
}

export const ImageInspector: React.FC<Props> = ({ card, update, linkedPromptText }) => {
  const channels = useChannels();
  const groups = useMemo(() => buildProviderGroups(channels, 'image'), [channels]);
  const provider = card.provider ?? 'ark';
  const isSeedream = provider === 'ark';
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
          model={card.model}
          modelLabel={(isSeedream ? IMAGE_MODELS.find((m) => m.id === card.model)?.name : undefined) ?? findModelOption(groups, provider, card.model)?.label ?? card.model}
          accent="pink"
          onSelect={(opt) => update(imageModelPatch(card, opt))}
        />
      </Section>

      <Section title="尺寸">
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
        compile={() => compileCardImagePayload(linkedPromptText ? { ...card, prompt: linkedPromptText } : card)}
      />
    </>
  );
};
