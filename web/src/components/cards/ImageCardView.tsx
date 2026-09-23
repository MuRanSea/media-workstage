import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Settings2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Code,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
} from 'lucide-react';
import {
  type SpatialCard,
  IMAGE_MODELS,
  SEEDREAM_PIXEL_MAP,
} from '../../types/canvas.ts';
import { compileCardImagePayload } from '../../engine/compiler.ts';
import {
  READY_CHANNELS,
  buildProviderGroups,
  findModelOption,
  type ModelOption,
} from '../../engine/channelModels.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from './ProviderModelPicker.tsx';
import {
  InputPort,
  OutputPort,
  LinkedPromptBox,
  connectHintRing,
  type ConnectHint,
} from './CardPorts.tsx';
import { assetStoredPath, assetUrl } from '../../engine/assetPaths.ts';

const RATIO_PRESETS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const;
const CHANNEL_RESOLUTIONS = ['1K', '2K', '4K'] as const;

const RatioGrid: React.FC<{
  value: string;
  onChange: (ratio: (typeof RATIO_PRESETS)[number]) => void;
}> = ({ value, onChange }) => (
  <div className="grid grid-cols-4 gap-1 text-[9px] font-mono">
    {RATIO_PRESETS.map((rt) => (
      <button
        key={rt}
        type="button"
        onClick={() => onChange(rt)}
        className={`py-1 rounded font-semibold ${
          value === rt ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-750'
        }`}
      >
        {rt}
      </button>
    ))}
  </div>
);

interface ImageCardViewProps {
  card: SpatialCard;
  isSelected: boolean;
  onUpdateCard: (cardId: string, updater: Partial<SpatialCard>) => void;
  onDeleteCard: (cardId: string) => void;
  onStartDrag: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTriggerGenerate: (cardId: string) => void;
  onUnpackLayers?: (card: SpatialCard) => void;
  onUnpackStoryboards?: (card: SpatialCard) => void;
  /** Set when a text card feeds this card's prompt. */
  linkedPrompt?: { title: string; text: string };
  onUnlinkPrompt?: () => void;
  onStartConnect?: (e: React.MouseEvent<HTMLDivElement>) => void;
  connectHint?: ConnectHint;
}

export const ImageCardView: React.FC<ImageCardViewProps> = ({
  card,
  isSelected,
  onUpdateCard,
  onDeleteCard,
  onStartDrag,
  onTriggerGenerate,
  onUnpackLayers,
  onUnpackStoryboards,
  linkedPrompt,
  onUnlinkPrompt,
  onStartConnect,
  connectHint,
}) => {
  const [showJsonInspector, setShowJsonInspector] = useState(false);
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number | null>(null);

  const channels = useChannels();
  const providerGroups = useMemo(() => buildProviderGroups(channels, 'image'), [channels]);

  const provider = card.provider ?? 'ark';
  // Ark runs Seedream with its tier/pixel/layer rules; every other channel gets ratio + resolution.
  const isSeedream = provider === 'ark';
  const seedreamDef = IMAGE_MODELS.find((m) => m.id === card.model);
  const currentModel = seedreamDef ?? IMAGE_MODELS[0];
  const displayName = isSeedream ? seedreamDef?.name ?? card.model : card.model;
  const canGenerate = READY_CHANNELS.image.has(provider);
  const currentOption = findModelOption(providerGroups, provider, card.model);

  const currentTier = card.imageTier ?? currentModel.defaultTier;
  const currentRatio = card.imageRatioPreset ?? '16:9';
  const currentResolution = card.imageResolution ?? '2K';
  const mappedPixels =
    SEEDREAM_PIXEL_MAP[currentTier]?.[currentRatio] ?? '2048x1152';
  const sizeSummary = !isSeedream
    ? `${currentResolution} • ${currentRatio}`
    : card.sizeMode === 'custom_pixels'
    ? card.customPixels
    : `${currentTier} • ${currentRatio}`;

  const selectModel = (option: ModelOption) => {
    if (option.provider === 'ark') {
      const modelDef = IMAGE_MODELS.find((m) => m.id === option.id);
      onUpdateCard(card.id, {
        provider: 'ark',
        model: option.id,
        imageTier: modelDef?.defaultTier ?? '2K',
        customPixels: modelDef?.defaultCustomPixel ?? '2048x1024',
        imageMode: 'single',
      });
    } else {
      onUpdateCard(card.id, {
        provider: option.provider,
        model: option.id,
        imageMode: 'single',
        sizeMode: 'tier',
        activeParamTab: 'specs',
        imageResolution: currentResolution,
      });
    }
  };

  const getCompiledJson = () => {
    try {
      return compileCardImagePayload(linkedPrompt?.text ? { ...card, prompt: linkedPrompt.text } : card);
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

  // Extract layer and frame assets
  const layerAssets = (card.outputAssets ?? []).filter((a) => a.kind === 'image_layer');
  const frameAssets = (card.outputAssets ?? []).filter((a) => a.kind === 'image_frame');
  const baseAsset = (card.outputAssets ?? []).find((a) => a.kind === 'image_base');

  // Determine active display image
  let activeDisplayUrl = card.resultUrl;
  if (selectedLayerIndex !== null && layerAssets[selectedLayerIndex]) {
    const activeLayer = layerAssets[selectedLayerIndex];
    activeDisplayUrl = assetStoredPath(activeLayer);
  } else if (baseAsset) {
    activeDisplayUrl = assetStoredPath(baseAsset);
  }

  const isGenerating = card.status === 'running' || card.status === 'queued';

  return (
    <div
      data-card-id={card.id}
      style={{
        transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
        width: `${card.width}px`,
      }}
      className={`absolute top-0 left-0 rounded-2xl bg-[#12141e]/95 backdrop-blur-xl border transition-all duration-75 select-none shadow-2xl ${
        connectHint
          ? connectHintRing(connectHint)
          : isSelected
          ? 'border-pink-500 ring-2 ring-pink-500/40 shadow-pink-500/25'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
    >
      <InputPort />
      {onStartConnect && <OutputPort color="pink" onStart={onStartConnect} />}
      {/* Header bar (Drag Handle) */}
      <div
        onMouseDown={onStartDrag}
        className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 cursor-grab active:cursor-grabbing bg-slate-900/40 rounded-t-2xl"
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-lg bg-pink-500/20 border border-pink-500/30 flex items-center justify-center">
            <ImageIcon className="w-3 h-3 text-pink-400" />
          </div>
          <input
            type="text"
            value={card.title}
            onChange={(e) => onUpdateCard(card.id, { title: e.target.value })}
            className="text-xs font-bold text-slate-100 bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-pink-500/50 rounded px-1 max-w-[150px]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-bold border border-pink-500/40">
            @图{card.tagIndex}
          </span>
          <button
            type="button"
            onClick={() => setShowJsonInspector(!showJsonInspector)}
            title="查看编译 JSON Payload"
            className="p-1 text-slate-400 hover:text-white rounded transition"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteCard(card.id);
            }}
            title="删除卡片"
            className="p-1 text-slate-500 hover:text-red-400 rounded transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* JSON Inspector modal */}
      {showJsonInspector && (
        <div className="p-2.5 bg-black/90 border-b border-slate-800 text-[10px] font-mono text-pink-300 max-h-48 overflow-auto">
          <pre>{JSON.stringify(getCompiledJson(), null, 2)}</pre>
        </div>
      )}

      {/* Main card body */}
      <div className="p-3 space-y-2.5">
        {/* Visual Preview Container */}
        <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-[16/10] flex items-center justify-center group">
          {activeDisplayUrl ? (
            <img
              src={assetUrl(activeDisplayUrl)}
              alt={card.title}
              className="w-full h-full object-cover rounded-xl"
              onError={(e) => {
                // Image load fallback
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-pink-950/40 via-slate-900 to-purple-950/40 flex flex-col items-center justify-center p-3 text-center">
              <ImageIcon className="w-6 h-6 text-pink-400 mb-1 opacity-70" />
              <span className="text-xs text-pink-200 font-semibold">
                {displayName}
              </span>
              <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                {!isSeedream
                  ? `${currentResolution} • ${currentRatio}`
                  : card.sizeMode === 'custom_pixels'
                  ? card.customPixels
                  : `${currentTier} (${mappedPixels})`}
              </span>
            </div>
          )}

          {/* Badge top-left */}
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] font-mono font-bold text-pink-300 border border-pink-500/30">
            @图{card.tagIndex}
          </div>

          {/* Status badge top-right */}
          {card.status === 'succeeded' && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] text-emerald-400 flex items-center gap-1 border border-emerald-500/30">
              <CheckCircle2 className="w-2.5 h-2.5" /> 就绪
            </div>
          )}

          {card.status === 'failed' && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-red-950/80 backdrop-blur text-[9px] text-red-300 flex items-center gap-1 border border-red-500/40">
              <AlertCircle className="w-2.5 h-2.5" /> 失败
            </div>
          )}

          {/* Layer switcher bar inside preview if layers exist */}
          {layerAssets.length > 0 && (
            <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1 bg-black/80 backdrop-blur px-2 py-1 rounded-lg text-[9px] font-mono overflow-x-auto">
              <button
                type="button"
                onClick={() => setSelectedLayerIndex(null)}
                className={`px-1.5 py-0.5 rounded ${
                  selectedLayerIndex === null ? 'bg-pink-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                底图
              </button>
              {layerAssets.map((layer, idx) => (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => setSelectedLayerIndex(idx)}
                  className={`px-1.5 py-0.5 rounded ${
                    selectedLayerIndex === idx ? 'bg-pink-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  图层{idx + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Provider → model picker: who generates this card */}
        <ProviderModelPicker
          groups={providerGroups}
          provider={provider}
          model={card.model}
          modelLabel={currentOption?.label ?? displayName}
          accent="pink"
          onSelect={selectModel}
        />

        {/* Size summary & parameter drawer toggle */}
        <div className="flex items-center justify-between text-xs px-1">
          <span className="font-mono text-[10px] text-slate-400">{sizeSummary}</span>
          <button
            type="button"
            onClick={() => onUpdateCard(card.id, { isExpanded: !card.isExpanded })}
            className={`text-[10px] font-medium flex items-center gap-1 px-2 py-0.5 rounded-lg border transition ${
              card.isExpanded
                ? 'bg-pink-600 text-white border-pink-500'
                : 'text-slate-400 hover:text-white bg-slate-800/80 border-slate-700'
            }`}
          >
            <Settings2 className="w-3 h-3" />
            {card.isExpanded ? '收起配置' : '展开参数'}
          </button>
        </div>

        {/* Channel (non-Seedream) parameters: ratio + resolution only */}
        {card.isExpanded && !isSeedream && (
          <div className="bg-[#0b0d14] border border-slate-800 p-2.5 rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">分辨率:</span>
              <div className="flex gap-1">
                {CHANNEL_RESOLUTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onUpdateCard(card.id, { imageResolution: r })}
                    className={`px-2 py-0.5 rounded font-mono font-bold ${
                      currentResolution === r ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400">宽高比:</span>
              <RatioGrid
                value={currentRatio}
                onChange={(rt) => onUpdateCard(card.id, { imageRatioPreset: rt })}
              />
            </div>
            <div className="text-[9px] text-slate-500 leading-relaxed">
              按所选模型换算实际像素；模型不支持分辨率档位时按其默认尺寸出图。
            </div>
          </div>
        )}

        {/* Expandable Parameter Drawer (Seedream) */}
        {card.isExpanded && isSeedream && (
          <div className="bg-[#0b0d14] border border-slate-800 p-2.5 rounded-xl space-y-2 text-xs">
            <div className="flex items-center gap-1 pb-1.5 border-b border-slate-800 text-[10px]">
              <button
                type="button"
                onClick={() => onUpdateCard(card.id, { activeParamTab: 'specs' })}
                className={`px-2 py-0.5 rounded-md font-semibold transition ${
                  card.activeParamTab === 'specs' || !card.activeParamTab
                    ? 'bg-pink-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                尺寸规格 (Size & Ratio)
              </button>
              <button
                type="button"
                onClick={() => onUpdateCard(card.id, { activeParamTab: 'advanced' })}
                className={`px-2 py-0.5 rounded-md font-semibold transition ${
                  card.activeParamTab === 'advanced'
                    ? 'bg-pink-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                高级模式 (Layer/Format)
              </button>
            </div>

            {/* Specs Tab */}
            {(card.activeParamTab === 'specs' || !card.activeParamTab) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">尺寸配置方式:</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onUpdateCard(card.id, { sizeMode: 'tier' })}
                      className={`px-2 py-0.5 rounded ${
                        card.sizeMode === 'tier' || !card.sizeMode
                          ? 'bg-pink-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      方式1: 档位预设
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCard(card.id, {
                          sizeMode: 'custom_pixels',
                          customPixels:
                            card.customPixels || currentModel.defaultCustomPixel,
                        })
                      }
                      className={`px-2 py-0.5 rounded ${
                        card.sizeMode === 'custom_pixels'
                          ? 'bg-pink-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      方式2: 显式像素
                    </button>
                  </div>
                </div>

                {card.sizeMode !== 'custom_pixels' ? (
                  <>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">分辨率档位:</span>
                      <div className="flex gap-1">
                        {currentModel.tiers.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => onUpdateCard(card.id, { imageTier: t })}
                            className={`px-2 py-0.5 rounded font-mono font-bold ${
                              currentTier === t
                                ? 'bg-pink-600 text-white'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-400">宽高比映射:</span>
                        <span className="font-mono text-pink-300 font-bold">
                          {mappedPixels}
                        </span>
                      </div>
                      <RatioGrid
                        value={currentRatio}
                        onChange={(rt) => onUpdateCard(card.id, { imageRatioPreset: rt })}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-slate-400">自定义宽高像素:</span>
                      <span className="font-mono text-[9px] text-slate-500">
                        {currentModel.pixelRangeText}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={card.customPixels ?? currentModel.defaultCustomPixel}
                      onChange={(e) =>
                        onUpdateCard(card.id, { customPixels: e.target.value })
                      }
                      className="w-full bg-[#161822] border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-pink-300 focus:outline-none focus:border-pink-500"
                      placeholder="例如 2048x1024"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Advanced Tab */}
            {card.activeParamTab === 'advanced' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">模式:</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onUpdateCard(card.id, { imageMode: 'single' })}
                      className={`px-2 py-0.5 rounded ${
                        card.imageMode === 'single' || !card.imageMode
                          ? 'bg-pink-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      单图
                    </button>
                    <button
                      type="button"
                      disabled={!currentModel.supportsLayerDecomp}
                      onClick={() =>
                        onUpdateCard(card.id, { imageMode: 'layer_decomp' })
                      }
                      className={`px-2 py-0.5 rounded ${
                        !currentModel.supportsLayerDecomp
                          ? 'opacity-30'
                          : card.imageMode === 'layer_decomp'
                          ? 'bg-pink-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      图层拆分 (16层)
                    </button>
                    <button
                      type="button"
                      disabled={!currentModel.supportsSequential}
                      onClick={() =>
                        onUpdateCard(card.id, { imageMode: 'sequential' })
                      }
                      className={`px-2 py-0.5 rounded ${
                        !currentModel.supportsSequential
                          ? 'opacity-30'
                          : card.imageMode === 'sequential'
                          ? 'bg-pink-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      连环组图 (15张)
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[10px]">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCard(card.id, {
                          imageFormat: card.imageFormat === 'png' ? 'jpeg' : 'png',
                        })
                      }
                      className="px-2 py-0.5 rounded bg-pink-500/10 text-pink-300 border border-pink-500/20 font-mono font-bold"
                    >
                      格式: {card.imageFormat?.toUpperCase() ?? 'JPEG'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCard(card.id, {
                          background:
                            card.background === 'transparent'
                              ? 'opaque'
                              : 'transparent',
                        })
                      }
                      className={`px-2 py-0.5 rounded border ${
                        card.background === 'transparent'
                          ? 'bg-pink-500/20 text-pink-200 border-pink-500/40'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {card.background === 'transparent'
                        ? '透明底 (PNG)'
                        : '不透明底'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateCard(card.id, { watermark: !card.watermark })
                    }
                    className={`px-2 py-0.5 rounded border ${
                      !card.watermark
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {!card.watermark ? '无水印' : '含水印'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Unpack multi-layer or sequential action buttons if assets present */}
        {layerAssets.length > 0 && onUnpackLayers && (
          <button
            type="button"
            onClick={() => onUnpackLayers(card)}
            className="w-full py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/40 rounded-xl text-[11px] font-bold text-indigo-300 flex items-center justify-center gap-1.5 transition active:scale-98 shadow-md"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>在画布展开 {layerAssets.length} 个透明图层</span>
          </button>
        )}

        {frameAssets.length > 0 && onUnpackStoryboards && (
          <button
            type="button"
            onClick={() => onUnpackStoryboards(card)}
            className="w-full py-1.5 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/40 rounded-xl text-[11px] font-bold text-purple-300 flex items-center justify-center gap-1.5 transition active:scale-98 shadow-md"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>在画布展开 {frameAssets.length} 张分镜卡片</span>
          </button>
        )}

        {/* Prompt: typed here, or fed by a connected text card */}
        {linkedPrompt ? (
          <LinkedPromptBox
            sourceTitle={linkedPrompt.title}
            text={linkedPrompt.text}
            onUnlink={() => onUnlinkPrompt?.()}
          />
        ) : (
          <textarea
            value={card.prompt}
            onChange={(e) => onUpdateCard(card.id, { prompt: e.target.value })}
            className="w-full bg-[#0b0d14] border border-slate-700/70 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-pink-500 resize-none h-14 leading-relaxed"
            placeholder="输入画面描述主体与光影..."
          />
        )}

        {/* Error message display if failed */}
        {card.errorMessage && (
          <div className="p-1.5 px-2 bg-red-950/60 border border-red-500/40 rounded-lg text-[10px] text-red-300 truncate">
            {card.errorMessage}
          </div>
        )}

        {/* Trigger generate button */}
        <button
          type="button"
          onClick={() => onTriggerGenerate(card.id)}
          disabled={isGenerating || !canGenerate}
          className="w-full py-2 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-pink-600/25 transition active:scale-98 disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中 {card.progress}%
            </>
          ) : !canGenerate ? (
            <>该渠道尚未接入生图</>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              {seedreamDef && isSeedream ? `生成 ${seedreamDef.name.split(' ')[1]} 图片` : '生成图片'}
            </>
          )}
        </button>
      </div>
    </div>
  );
};
