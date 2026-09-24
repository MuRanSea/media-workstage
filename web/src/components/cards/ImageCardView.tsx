import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, Layers, LayoutGrid, Maximize2, Sparkles } from 'lucide-react';
import { IMAGE_MODELS, type ResultActionDto } from '../../types/canvas.ts';
import { actionLabel, groupActions } from '../../engine/derivedCards.ts';
import { MJ_MAX_REFERENCES, MJ_MIN_BLEND_IMAGES } from '../../engine/connections.ts';
import {
  MISSING_PROVIDER_HINT,
  buildProviderGroups,
  findModelOption,
  isModelReady,
  isProviderMissing,
} from '../../engine/channelModels.ts';
import { protocolOf } from '../../engine/providers.ts';
import { imageSizeSummary, requestedAspect } from '../../engine/cardParams.ts';
import { useChannels } from '../../services/channels.ts';
import { assetStoredPath, assetUrl } from '../../engine/assetPaths.ts';
import { Button } from '../ui/Button.tsx';
import { InputPort, OutputPort, LinkedPromptBox } from './CardPorts.tsx';
import {
  AutoTextarea,
  CardShell,
  ErrorBox,
  GeneratingOverlay,
  MediaFrame,
  StatusChip,
  SummaryRow,
  TagBadge,
} from './CardShell.tsx';
import type { CardViewProps } from './cardProps.ts';

interface ImageCardViewProps extends CardViewProps {
  onUnpackLayers?: (card: CardViewProps['card']) => void;
  onUnpackStoryboards?: (card: CardViewProps['card']) => void;
  /** Set when a text card feeds this card's prompt. */
  linkedPrompt?: { title: string; text: string };
  onUnlinkPrompt?: () => void;
  onStartConnect?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Runs one of the result's follow-ups on a new card. */
  onRunAction?: (action: ResultActionDto) => void;
  /** Follow-ups already running on a derived card. */
  busyActionIds?: ReadonlySet<string>;
}

export const ImageCardView: React.FC<ImageCardViewProps> = ({
  card,
  isSelected,
  connectHint,
  onSelect,
  onStartDrag,
  onUpdateCard,
  onTriggerGenerate,
  menuItems,
  onOpenViewer,
  onUnpackLayers,
  onUnpackStoryboards,
  linkedPrompt,
  onUnlinkPrompt,
  onStartConnect,
  onRunAction,
  busyActionIds,
}) => {
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number | null>(null);
  const [loadedAspect, setLoadedAspect] = useState<number>();
  const channels = useChannels();
  const providerGroups = useMemo(() => buildProviderGroups(channels, 'image'), [channels]);
  const provider = card.provider ?? 'ark';
  const seedreamDef = protocolOf(provider) === 'ark' ? IMAGE_MODELS.find((m) => m.id === card.model) : undefined;
  const modelLabel =
    seedreamDef?.name ?? findModelOption(providerGroups, provider, card.model)?.label ?? card.model;
  const missing = isProviderMissing(channels, card.provider);
  const canGenerate = isModelReady('image', provider, card.model);
  const isGenerating = card.status === 'running' || card.status === 'queued';

  const layerAssets = (card.outputAssets ?? []).filter((a) => a.kind === 'image_layer');
  const frameAssets = (card.outputAssets ?? []).filter((a) => a.kind === 'image_frame');
  const baseAsset = (card.outputAssets ?? []).find((a) => a.kind === 'image_base');
  const displayPath =
    selectedLayerIndex !== null && layerAssets[selectedLayerIndex]
      ? assetStoredPath(layerAssets[selectedLayerIndex])
      : baseAsset
        ? assetStoredPath(baseAsset)
        : card.resultUrl;
  const displayUrl = assetUrl(displayPath);

  return (
    <CardShell
      card={card}
      accent="pink"
      icon={<ImageIcon className="w-4 h-4" />}
      isSelected={isSelected}
      connectHint={connectHint}
      onSelect={onSelect}
      onStartDrag={onStartDrag}
      onRename={(title) => onUpdateCard(card.id, { title })}
      badges={<TagBadge tagIndex={card.tagIndex} accent="pink" />}
      menuItems={menuItems}
      ports={
        <>
          <InputPort />
          {onStartConnect && <OutputPort color="pink" onStart={onStartConnect} />}
        </>
      }
    >
      {/* Preview */}
      <MediaFrame aspect={(displayUrl && loadedAspect) || requestedAspect(card)}>
        {displayUrl ? (
          <button
            type="button"
            title="查看大图"
            onClick={() => onOpenViewer({ url: displayUrl, kind: 'image', title: card.title })}
            className="block w-full h-full cursor-zoom-in"
          >
            <img
              src={displayUrl}
              alt={card.title}
              className="w-full h-full object-contain"
              onLoad={(e) => setLoadedAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
              onError={(e) => ((e.target as HTMLElement).style.visibility = 'hidden')}
            />
            <span className="absolute bottom-2 right-2 p-1 rounded-md bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition">
              <Maximize2 className="w-3.5 h-3.5" />
            </span>
          </button>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-pink-950/30 via-slate-900 to-slate-950 text-center">
            <ImageIcon className="w-6 h-6 text-pink-400/60" />
            <span className="text-[11px] text-slate-500">生成结果会显示在这里</span>
          </div>
        )}
        <StatusChip status={card.status} />
        {isGenerating && <GeneratingOverlay progress={card.progress} />}

        {layerAssets.length > 0 && (
          <div className="absolute bottom-2 left-2 right-10 flex items-center gap-1 bg-black/75 px-1.5 py-1 rounded-lg text-[11px] overflow-x-auto">
            {[null, ...layerAssets.map((_, i) => i)].map((idx) => (
              <button
                key={idx ?? 'base'}
                type="button"
                onClick={() => setSelectedLayerIndex(idx)}
                className={`px-1.5 py-px rounded whitespace-nowrap ${
                  selectedLayerIndex === idx ? 'bg-pink-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                {idx === null ? '底图' : `图层 ${idx + 1}`}
              </button>
            ))}
          </div>
        )}
      </MediaFrame>

      <SummaryRow model={modelLabel} spec={imageSizeSummary(card)} />

      {onRunAction && card.status === 'succeeded' && card.resultActions?.length ? (
        <ResultActions actions={card.resultActions} busy={busyActionIds} onRun={onRunAction} />
      ) : null}

      {layerAssets.length > 0 && onUnpackLayers && (
        <Button size="sm" block icon={<Layers className="w-3.5 h-3.5" />} onClick={() => onUnpackLayers(card)}>
          把 {layerAssets.length} 个图层展开成卡片
        </Button>
      )}
      {frameAssets.length > 0 && onUnpackStoryboards && (
        <Button size="sm" block icon={<LayoutGrid className="w-3.5 h-3.5" />} onClick={() => onUnpackStoryboards(card)}>
          把 {frameAssets.length} 张分镜展开成卡片
        </Button>
      )}

      {card.mjOperation === 'blend' && protocolOf(provider) === 'midjourney' ? (
        <p className="text-[11px] leading-relaxed text-slate-500 px-1">
          Blend 混合连入的 {card.references?.length ?? 0} 张图片，不使用提示词（需要 {MJ_MIN_BLEND_IMAGES}–{MJ_MAX_REFERENCES} 张）。
        </p>
      ) : linkedPrompt ? (
        <LinkedPromptBox sourceTitle={linkedPrompt.title} text={linkedPrompt.text} onUnlink={() => onUnlinkPrompt?.()} />
      ) : (
        <AutoTextarea
          accent="pink"
          value={card.prompt}
          onChange={(e) => onUpdateCard(card.id, { prompt: e.target.value })}
          placeholder="描述画面：主体、场景、风格、光线…"
        />
      )}

      {card.errorMessage && <ErrorBox message={card.errorMessage} />}

      <Button
        variant="primary"
        accent="pink"
        block
        disabled={isGenerating || !canGenerate}
        onClick={() => onTriggerGenerate(card.id)}
        icon={!isGenerating && canGenerate ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
      >
        {isGenerating ? '生成中…' : missing ? MISSING_PROVIDER_HINT : !canGenerate ? '这个服务商还不支持生图' : card.resultUrl ? '重新生成' : '生成图片'}
      </Button>
    </CardShell>
  );
};

/** The result's follow-ups (Midjourney U / V rows, then the rest); each opens a new card. */
const ResultActions: React.FC<{
  actions: ResultActionDto[];
  busy?: ReadonlySet<string>;
  onRun: (action: ResultActionDto) => void;
}> = ({ actions, busy, onRun }) => {
  const { upscale, variation, other } = groupActions(actions);
  const row = (items: ResultActionDto[], columns: boolean) =>
    items.length > 0 && (
      <div className={columns ? 'grid grid-cols-4 gap-1' : 'flex flex-wrap gap-1'}>
        {items.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={busy?.has(a.id)}
            title={`${actionLabel(a)}：在新卡片中执行`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onRun(a)}
            className="px-2 py-1 rounded-md border border-slate-700 bg-slate-900/70 text-[11px] text-slate-200 hover:border-pink-500/60 hover:text-white disabled:opacity-40 disabled:cursor-wait transition"
          >
            {a.label && a.emoji ? `${a.emoji} ${a.label}` : actionLabel(a)}
          </button>
        ))}
      </div>
    );
  return (
    <div className="space-y-1">
      {row(upscale, true)}
      {row(variation, true)}
      {row(other, false)}
    </div>
  );
};
