import React, { useMemo, useState } from 'react';
import { Image as ImageIcon, Loader2, Maximize2, Sparkles } from 'lucide-react';
import { IMAGE_MODELS, type ResultActionDto, type SpatialCard } from '../../types/canvas.ts';
import {
  MISSING_PROVIDER_HINT,
  buildProviderGroups,
  findModelOption,
  isModelReady,
  isProviderMissing,
} from '../../engine/channelModels.ts';
import { protocolOf } from '../../engine/providers.ts';
import { imageSizeSummary, previewAspect } from '../../engine/cardParams.ts';
import { useChannels } from '../../services/channels.ts';
import { assetStoredPath, assetUrl } from '../../engine/assetPaths.ts';
import { offersUpload } from '../../engine/uploadRefs.ts';
import { isMidjourney } from '../../engine/midjourney.ts';
import { actionLabel, groupActions } from '../../engine/resultCards.ts';
import { refTag } from '../../engine/refTags.ts';
import { Button } from '../ui/Button.tsx';
import { InputPort, OutputPort, LinkedPromptBox } from './CardPorts.tsx';
import {
  AutoTextarea,
  CardShell,
  ErrorBox,
  GeneratingOverlay,
  MediaFrame,
  RunsBadge,
  StatusChip,
  SummaryRow,
  TagBadge,
} from './CardShell.tsx';
import { UploadPanel } from './UploadPanel.tsx';
import type { CardViewProps } from './cardProps.ts';

interface ImageCardViewProps extends CardViewProps {
  /** Set when a text card feeds this card's prompt. */
  linkedPrompt?: { title: string; text: string };
  onUnlinkPrompt?: () => void;
  onStartConnect?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Generation cards: the submit request is in flight. */
  isSubmitting?: boolean;
  /** Generation cards: result cards still queued or running. */
  runsInProgress?: number;
  /** Result cards: runs one of the result's follow-ups (Midjourney U/V/reroll). */
  onRunAction?: (action: ResultActionDto) => void;
  /** Result cards: follow-ups with a run in flight. */
  busyActionIds?: ReadonlySet<string>;
}

/** A finished result's follow-ups: the U row, the V row, then the rest (reroll, zoom, pan …). */
const ActionBar: React.FC<{ card: SpatialCard; onRun: (action: ResultActionDto) => void; busy?: ReadonlySet<string> }> = ({
  card,
  onRun,
  busy,
}) => {
  const { upscale, variation, other } = groupActions(card.resultActions ?? []);
  const rows = [upscale, variation, other].filter((row) => row.length);
  return (
    <div className="space-y-1">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap gap-1">
          {row.map((action) => {
            const running = busy?.has(action.id);
            const label = actionLabel(action);
            return (
              <button
                key={action.id}
                type="button"
                disabled={running}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onRun(action)}
                title={running ? `${label} 正在生成` : `${label}：生成一张新的结果卡`}
                className="flex items-center gap-1 min-w-[2.25rem] justify-center px-1.5 py-0.5 rounded-md border border-slate-700 bg-slate-800/60 text-[11px] font-mono text-slate-200 hover:border-pink-500/60 hover:text-pink-200 disabled:opacity-50"
              >
                {running && <Loader2 className="w-3 h-3 animate-spin" />}
                {action.emoji && action.label ? `${action.emoji} ${action.label}` : label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};

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
  linkedPrompt,
  onUnlinkPrompt,
  onStartConnect,
  isSubmitting = false,
  runsInProgress = 0,
  onRunAction,
  busyActionIds,
}) => {
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
  // Result cards hold exactly one image.
  const displayUrl = assetUrl(card.resultUrl ?? assetStoredPath(card.outputAssets?.[0]));

  const mj = isMidjourney(card);
  const blending = mj && card.mjOperation === 'blend';
  const promptInput = blending ? (
    <p className="rounded-xl border border-dashed border-pink-500/30 bg-pink-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-pink-100/80">
      Blend：把连入的 {card.references?.length ?? 0} 张图片混合成一张，不用提示词。
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
  );

  // Generation cards only configure runs; each run's output lands on its own result card.
  if (card.role === 'generation') {
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
        badges={<RunsBadge count={runsInProgress} accent="pink" />}
        menuItems={menuItems}
        ports={<InputPort />}
      >
        <SummaryRow model={modelLabel} spec={imageSizeSummary(card)} />
        {mj && !!card.references?.length && (
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]" title="在属性面板里管理参考图">
            <span className="text-slate-500">参考图</span>
            {card.references.map((ref) => (
              <span key={ref.cardId} className="font-mono px-1.5 py-px rounded-md border bg-pink-500/15 text-pink-300 border-pink-500/30">
                {refTag(ref)}
              </span>
            ))}
          </div>
        )}
        {promptInput}
        {card.errorMessage && <ErrorBox message={card.errorMessage} />}
        <Button
          variant="primary"
          accent="pink"
          block
          disabled={isSubmitting || missing || !canGenerate}
          onClick={() => onTriggerGenerate(card.id)}
          icon={!missing && canGenerate ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
        >
          {missing ? MISSING_PROVIDER_HINT : !canGenerate ? '这个服务商还不支持生图' : '生成'}
        </Button>
      </CardShell>
    );
  }

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
      ports={onStartConnect && <OutputPort color="pink" onStart={onStartConnect} />}
    >
      {/* Preview */}
      <MediaFrame aspect={(displayUrl && loadedAspect) || previewAspect(card)}>
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
              decoding="async"
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
            <span className="text-[11px] text-slate-500">等待生成结果</span>
          </div>
        )}
        <StatusChip status={card.status} />
        {isGenerating && <GeneratingOverlay progress={card.progress} />}
      </MediaFrame>

      <SummaryRow model={modelLabel} spec={imageSizeSummary(card)} />

      {card.status === 'succeeded' && !!card.resultActions?.length && onRunAction && (
        <ActionBar card={card} onRun={onRunAction} busy={busyActionIds} />
      )}

      {offersUpload(card) && <UploadPanel card={card} onUpdateCard={onUpdateCard} accent="pink" />}

      {card.errorMessage && <ErrorBox message={card.errorMessage} />}
    </CardShell>
  );
};
