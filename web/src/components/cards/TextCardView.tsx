import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Link2, Sparkles } from 'lucide-react';
import { MISSING_PROVIDER_HINT, buildProviderGroups, findModelOption, isProviderMissing } from '../../engine/channelModels.ts';
import { getTextPreset } from '../../engine/textPresets.ts';
import { useChannels } from '../../services/channels.ts';
import { Button } from '../ui/Button.tsx';
import { OutputPort } from './CardPorts.tsx';
import { AutoTextarea, CardShell, ErrorBox, RunsBadge, SummaryRow } from './CardShell.tsx';
import type { CardViewProps } from './cardProps.ts';
import type { TextPreset } from '../../types/canvas.ts';

interface TextCardViewProps extends CardViewProps {
  /** How many image/video cards take their prompt from this card. */
  linkedCount: number;
  /** Set on cards with an output port. */
  onStartConnect?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Generation cards: prompt-assistant requests still in flight. */
  runsInProgress?: number;
}

/**
 * LLM card: turns a rough idea into a prompt that can feed image and video cards.
 * A generation card holds the idea, preset and model; each run adds a text result
 * card whose text can be edited.
 */
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
  runsInProgress = 0,
}) => {
  const [copied, setCopied] = useState(false);
  const channels = useChannels();
  const providerGroups = useMemo(() => buildProviderGroups(channels, 'text'), [channels]);
  const preset = getTextPreset(card.textPreset);
  const isResult = card.role === 'result';

  // New cards start on the first bound chat model once channel config has loaded.
  useEffect(() => {
    if (isResult || card.model || providerGroups.length === 0) return;
    const first = providerGroups[0].options.find((o) => o.ready);
    if (first) onUpdateCard(card.id, { provider: first.provider, model: first.id }, { history: false });
  }, [isResult, card.id, card.model, providerGroups, onUpdateCard]);

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

  const shellProps = {
    card,
    accent: 'emerald' as const,
    icon: <FileText className="w-4 h-4" />,
    isSelected,
    connectHint,
    onSelect,
    onStartDrag,
    onRename: (title: string) => onUpdateCard(card.id, { title }),
    menuItems,
  };

  const noModelsHint = providerGroups.length === 0 && (
    <div className="text-[11px] leading-relaxed text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-2">
      还没有可用的文本模型。打开右上角「设置」，给任一服务商填好 Key 并绑定对话模型。
    </div>
  );

  const linkedBadge =
    linkedCount > 0 ? (
      <span
        title={`${linkedCount} 张卡片用这里的输出作为提示词`}
        className="flex items-center gap-0.5 text-[11px] px-1.5 py-px rounded-md border bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      >
        <Link2 className="w-3 h-3" /> {linkedCount}
      </span>
    ) : null;

  const outputEditor = (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>生成的文本（可修改，不影响生成卡）</span>
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
  );

  if (card.role === 'result') {
    const snapshotPreset = getTextPreset(card.snapshot?.params.textPreset as TextPreset | undefined);
    return (
      <CardShell
        {...shellProps}
        badges={linkedBadge}
        ports={onStartConnect && <OutputPort color="emerald" onStart={onStartConnect} />}
      >
        <SummaryRow
          model={snapshotPreset.label}
          spec={findModelOption(providerGroups, card.snapshot?.provider ?? provider, card.snapshot?.model ?? card.model)?.label ?? card.snapshot?.model ?? card.model}
        />
        {outputEditor}
      </CardShell>
    );
  }

  return (
    <CardShell {...shellProps} badges={<RunsBadge count={runsInProgress} accent="emerald" />}>
      <SummaryRow model={preset.label} spec={modelLabel} />
      {noModelsHint}
      <AutoTextarea
        accent="emerald"
        value={card.prompt}
        onChange={(e) => onUpdateCard(card.id, { prompt: e.target.value })}
        placeholder={preset.placeholder}
      />
      {card.errorMessage && <ErrorBox message={card.errorMessage} />}
      {/* Runs may overlap: each one adds its own result card. */}
      <Button
        variant="primary"
        accent="emerald"
        block
        disabled={missing || !card.model || !card.prompt.trim()}
        onClick={() => onTriggerGenerate(card.id)}
        icon={missing ? undefined : <Sparkles className="w-3.5 h-3.5" />}
      >
        {missing ? MISSING_PROVIDER_HINT : '生成'}
      </Button>
    </CardShell>
  );
};
