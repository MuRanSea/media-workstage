import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Link2, Sparkles } from 'lucide-react';
import { MISSING_PROVIDER_HINT, buildProviderGroups, findModelOption, isProviderMissing } from '../../engine/channelModels.ts';
import { getTextPreset } from '../../engine/textPresets.ts';
import { isDescribeCard } from '../../types/canvas.ts';
import { useChannels } from '../../services/channels.ts';
import { Button } from '../ui/Button.tsx';
import { OutputPort } from './CardPorts.tsx';
import { AutoTextarea, CardShell, ErrorBox, SummaryRow } from './CardShell.tsx';
import type { CardViewProps } from './cardProps.ts';

interface TextCardViewProps extends CardViewProps {
  /** How many image/video cards take their prompt from this card. */
  linkedCount: number;
  onStartConnect: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/** LLM card: turns a rough idea into a prompt that can feed image and video cards. */
export const TextCardView: React.FC<TextCardViewProps> = ({
  card,
  isSelected,
  connectHint,
  onSelect,
  onStartDrag,
  onUpdateCard,
  onTriggerGenerate,
  menuItems,
  linkedCount,
  onStartConnect,
}) => {
  const [copied, setCopied] = useState(false);
  const channels = useChannels();
  const providerGroups = useMemo(() => buildProviderGroups(channels, 'text'), [channels]);
  const preset = getTextPreset(card.textPreset);
  const isGenerating = card.status === 'running' || card.status === 'queued';
  // Describe cards run Midjourney on their source image instead of chatting with an LLM.
  const isDescribe = isDescribeCard(card);

  // New cards start on the first bound chat model once channel config has loaded.
  useEffect(() => {
    if (isDescribe || card.model || providerGroups.length === 0) return;
    const first = providerGroups[0].options.find((o) => o.ready);
    if (first) onUpdateCard(card.id, { provider: first.provider, model: first.id }, { history: false });
  }, [isDescribe, card.id, card.model, providerGroups, onUpdateCard]);

  const provider = card.provider ?? providerGroups[0]?.provider ?? 'openai';
  const missing = isProviderMissing(channels, card.provider);
  const modelLabel = findModelOption(providerGroups, provider, card.model)?.label ?? (card.model || '未选择模型');

  const copyOutput = async () => {
    try {
      await navigator.clipboard.writeText(card.textOutput ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions); the text is still selectable.
    }
  };

  return (
    <CardShell
      card={card}
      accent="emerald"
      icon={<FileText className="w-4 h-4" />}
      isSelected={isSelected}
      connectHint={connectHint}
      onSelect={onSelect}
      onStartDrag={onStartDrag}
      onRename={(title) => onUpdateCard(card.id, { title })}
      badges={
        linkedCount > 0 ? (
          <span
            title={`${linkedCount} 张卡片用这里的输出作为提示词`}
            className="flex items-center gap-0.5 text-[11px] px-1.5 py-px rounded-md border bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
          >
            <Link2 className="w-3 h-3" /> {linkedCount}
          </span>
        ) : null
      }
      menuItems={menuItems}
      ports={<OutputPort color="emerald" onStart={onStartConnect} />}
    >
      <SummaryRow model={isDescribe ? 'Midjourney 反推' : preset.label} spec={isDescribe ? card.model : modelLabel} />

      {isDescribe ? (
        <p className="text-[11px] leading-relaxed text-slate-500 px-1">
          把来源图片交给 Midjourney 反推提示词，结果可以拖右侧圆点连到图片卡片使用。
        </p>
      ) : (
        <>
          {providerGroups.length === 0 && (
            <div className="text-[11px] leading-relaxed text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-2">
              还没有可用的文本模型。打开右上角「设置」，给任一服务商填好 Key 并绑定对话模型。
            </div>
          )}

          <AutoTextarea
            accent="emerald"
            value={card.prompt}
            onChange={(e) => onUpdateCard(card.id, { prompt: e.target.value })}
            placeholder={preset.placeholder}
          />
        </>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>{linkedCount > 0 ? '输出（已连到其他卡片，可直接修改）' : '输出（可修改，拖右侧圆点连到图片或视频卡片）'}</span>
          <button
            type="button"
            onClick={copyOutput}
            disabled={!card.textOutput}
            className="flex items-center gap-0.5 hover:text-slate-200 disabled:opacity-40"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
        <AutoTextarea
          accent="emerald"
          minRows={4}
          maxRows={10}
          value={card.textOutput ?? ''}
          onChange={(e) => onUpdateCard(card.id, { textOutput: e.target.value })}
          placeholder="生成的文本会显示在这里"
          className="border-emerald-900/60 text-emerald-50"
        />
      </div>

      {card.errorMessage && <ErrorBox message={card.errorMessage} />}

      <Button
        variant="primary"
        accent="emerald"
        block
        disabled={isGenerating || missing || !card.model || (!isDescribe && !card.prompt.trim())}
        onClick={() => onTriggerGenerate(card.id)}
        icon={isGenerating ? undefined : <Sparkles className="w-3.5 h-3.5" />}
      >
        {isGenerating
          ? '生成中…'
          : missing
            ? MISSING_PROVIDER_HINT
            : isDescribe
              ? card.textOutput
                ? '重新反推'
                : '反推提示词'
              : preset.id === 'free'
                ? '生成回答'
                : `生成${preset.label}`}
      </Button>
    </CardShell>
  );
};
