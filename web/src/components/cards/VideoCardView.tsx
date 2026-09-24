import React, { useMemo, useRef, useState } from 'react';
import { AtSign, Film, Maximize2, Plus, Sparkles, Volume2 } from 'lucide-react';
import type { SpatialCard } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption, isModelReady } from '../../engine/channelModels.ts';
import { videoModelDef, videoSpecSummary } from '../../engine/cardParams.ts';
import { connectCards } from '../../engine/connections.ts';
import { inferVideoProvider } from '../../engine/videoCompiler.ts';
import { useChannels } from '../../services/channels.ts';
import { assetUrl } from '../../engine/assetPaths.ts';
import { Button } from '../ui/Button.tsx';
import { Menu } from '../ui/Menu.tsx';
import { InputPort, LinkedPromptBox } from './CardPorts.tsx';
import {
  AutoTextarea,
  CardShell,
  ErrorBox,
  GeneratingOverlay,
  StatusChip,
  SummaryRow,
  TagBadge,
} from './CardShell.tsx';
import type { CardViewProps } from './cardProps.ts';

interface VideoCardViewProps extends CardViewProps {
  availableImageCards: SpatialCard[];
  linkedPrompt?: { title: string; text: string };
  onUnlinkPrompt?: () => void;
  /** Explains why an image could not be attached. */
  onNotice: (message: string) => void;
}

export const VideoCardView: React.FC<VideoCardViewProps> = ({
  card,
  isSelected,
  connectHint,
  onSelect,
  onStartDrag,
  onUpdateCard,
  onTriggerGenerate,
  menuItems,
  onOpenViewer,
  availableImageCards,
  linkedPrompt,
  onUnlinkPrompt,
  onNotice,
}) => {
  const [pickerAt, setPickerAt] = useState<{ x: number; y: number } | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursor, setMentionCursor] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const channels = useChannels();
  const providerGroups = useMemo(() => buildProviderGroups(channels, 'video'), [channels]);
  const provider = card.provider ?? inferVideoProvider(card.model);
  const def = videoModelDef(card);
  const modelLabel = findModelOption(providerGroups, provider, card.model)?.label ?? def.name;
  const canGenerate = isModelReady('video', provider, card.model);
  const isGenerating = card.status === 'running' || card.status === 'queued';
  const videoUrl = assetUrl(card.resultUrl);
  const refs = card.references ?? [];

  /** Same rules as dragging a line from the image card onto this one. */
  const attach = (image: SpatialCard): boolean => {
    const res = connectCards(image, card);
    if (!res.ok) {
      onNotice(res.reason);
      return false;
    }
    onUpdateCard(card.id, res.patch);
    return true;
  };

  const insertTag = (tagIndex: number) => {
    const tag = `@图${tagIndex}`;
    const el = promptRef.current;
    if (!el) return onUpdateCard(card.id, { prompt: `${card.prompt} ${tag}`.trim() });
    const { selectionStart: start, selectionEnd: end } = el;
    onUpdateCard(card.id, { prompt: `${card.prompt.slice(0, start)}${tag} ${card.prompt.slice(end)}` });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + tag.length + 1, start + tag.length + 1);
    });
  };

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    onUpdateCard(card.id, { prompt: value });
    if (card.mode === 'text_to_video') return setMentionQuery(null);
    const cursor = e.target.selectionStart;
    const match = value.slice(0, cursor).match(/@([^\s@]*)$/);
    setMentionQuery(match ? match[1] : null);
    setMentionCursor(cursor);
  };

  const selectMention = (image: SpatialCard) => {
    const tagged = `${card.prompt.slice(0, mentionCursor).replace(/@([^\s@]*)$/, `@图${image.tagIndex} `)}${card.prompt.slice(mentionCursor)}`;
    const alreadyRef = refs.some((r) => r.cardId === image.id);
    if (alreadyRef || attach(image)) onUpdateCard(card.id, { prompt: tagged });
    setMentionQuery(null);
    requestAnimationFrame(() => promptRef.current?.focus());
  };

  const mentions =
    mentionQuery === null
      ? []
      : availableImageCards.filter(
          (img) => mentionQuery === '' || `图${img.tagIndex}`.includes(mentionQuery) || img.title.toLowerCase().includes(mentionQuery.toLowerCase())
        );

  return (
    <CardShell
      card={card}
      accent="indigo"
      icon={<Film className="w-4 h-4" />}
      isSelected={isSelected}
      connectHint={connectHint}
      onSelect={onSelect}
      onStartDrag={onStartDrag}
      onRename={(title) => onUpdateCard(card.id, { title })}
      badges={<TagBadge tagIndex={card.tagIndex} accent="indigo" />}
      menuItems={menuItems}
      ports={<InputPort />}
    >
      {/* Preview / player */}
      <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-black aspect-video group">
        {videoUrl ? (
          <>
            <video src={videoUrl} autoPlay loop muted playsInline controls className="w-full h-full object-cover" />
            <button
              type="button"
              title="放大播放"
              onClick={() => onOpenViewer({ url: videoUrl, kind: 'video', title: card.title })}
              className="absolute top-2 left-2 p-1 rounded-md bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-indigo-950/30 via-slate-900 to-slate-950">
            <Film className="w-6 h-6 text-indigo-400/60" />
            <span className="text-[11px] text-slate-500">生成的视频会在这里播放</span>
          </div>
        )}
        <StatusChip status={card.status} />
        {isGenerating && <GeneratingOverlay progress={card.progress} />}
      </div>

      <SummaryRow
        model={modelLabel}
        spec={videoSpecSummary(card)}
        extra={card.generateAudio && def.supportsAudio ? <Volume2 className="w-3 h-3 text-emerald-400 flex-shrink-0" /> : null}
      />

      {/* Reference chips: click to insert the tag into the prompt */}
      {card.mode !== 'text_to_video' && (
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          <span className="text-slate-500">参考图</span>
          {refs.map((ref) => (
            <button
              key={ref.cardId}
              type="button"
              onClick={() => insertTag(ref.tagIndex)}
              title={`插入 @图${ref.tagIndex} 到提示词`}
              className="font-mono px-1.5 py-px rounded-md border bg-pink-500/15 text-pink-300 border-pink-500/30 hover:bg-pink-500/25"
            >
              @图{ref.tagIndex}
            </button>
          ))}
          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPickerAt({ x: r.left, y: r.bottom + 4 });
            }}
            className="flex items-center gap-0.5 px-1.5 py-px rounded-md text-indigo-300 hover:bg-indigo-500/15"
          >
            <Plus className="w-3 h-3" /> 添加
          </button>
          <span className="ml-auto text-slate-600 font-mono">
            {refs.length}/{card.mode === 'first_last_frame' ? Math.min(2, def.maxRefs) : def.maxRefs}
          </span>
        </div>
      )}
      {pickerAt && (
        <Menu
          at={pickerAt}
          title={availableImageCards.length ? '选择画布上的图片卡片' : '画布上还没有图片卡片'}
          onClose={() => setPickerAt(null)}
          items={availableImageCards.map((img) => ({
            label: `@图${img.tagIndex}  ${img.title}`,
            hint: refs.some((r) => r.cardId === img.id) ? '已添加' : undefined,
            disabled: refs.some((r) => r.cardId === img.id),
            onSelect: () => void attach(img),
          }))}
        />
      )}

      {linkedPrompt ? (
        <LinkedPromptBox sourceTitle={linkedPrompt.title} text={linkedPrompt.text} onUnlink={() => onUnlinkPrompt?.()} />
      ) : (
        <div className="relative">
          <AutoTextarea
            accent="indigo"
            textareaRef={promptRef}
            value={card.prompt}
            onChange={handlePromptChange}
            onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
            placeholder={card.mode === 'text_to_video' ? '描述镜头：画面、运镜、节奏…' : '描述镜头，输入 @ 引用参考图…'}
          />
          {mentionQuery !== null && (
            <div className="absolute bottom-full left-0 mb-1.5 w-64 bg-canvas-surface border border-slate-700 rounded-xl p-1 shadow-2xl z-40">
              <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-slate-400">
                <AtSign className="w-3 h-3" /> 引用参考图
              </div>
              {mentions.length > 0 ? (
                mentions.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectMention(img)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-xs hover:bg-slate-800"
                  >
                    <span className="font-mono text-pink-300">@图{img.tagIndex}</span>
                    <span className="truncate text-slate-300">{img.title}</span>
                  </button>
                ))
              ) : (
                <div className="px-2 py-1.5 text-[11px] text-slate-500">没有匹配的图片卡片</div>
              )}
            </div>
          )}
        </div>
      )}

      {card.errorMessage && <ErrorBox message={card.errorMessage} />}

      <Button
        variant="primary"
        accent="indigo"
        block
        disabled={isGenerating || !canGenerate}
        onClick={() => onTriggerGenerate(card.id)}
        icon={!isGenerating && canGenerate ? <Sparkles className="w-3.5 h-3.5" /> : undefined}
      >
        {isGenerating ? '生成中…' : !canGenerate ? '这个模型还不支持生成视频' : card.resultUrl ? '重新生成' : '生成视频'}
      </Button>
    </CardShell>
  );
};
