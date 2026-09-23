import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Trash2, Loader2, Sparkles, Copy, Check, AlertCircle, Link2 } from 'lucide-react';
import type { SpatialCard } from '../../types/canvas.ts';
import { buildProviderGroups, findModelOption, type ModelOption } from '../../engine/channelModels.ts';
import { TEXT_PRESETS, getTextPreset } from '../../engine/textPresets.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from './ProviderModelPicker.tsx';
import { OutputPort, connectHintRing, type ConnectHint } from './CardPorts.tsx';

interface TextCardViewProps {
  card: SpatialCard;
  isSelected: boolean;
  /** How many image/video cards take their prompt from this card. */
  linkedCount: number;
  connectHint?: ConnectHint;
  onUpdateCard: (cardId: string, updater: Partial<SpatialCard>) => void;
  onDeleteCard: (cardId: string) => void;
  onStartDrag: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTriggerGenerate: (cardId: string) => void;
  onStartConnect: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/** LLM card: turns a rough idea into a prompt that can feed image and video cards. */
export const TextCardView: React.FC<TextCardViewProps> = ({
  card,
  isSelected,
  linkedCount,
  connectHint,
  onUpdateCard,
  onDeleteCard,
  onStartDrag,
  onTriggerGenerate,
  onStartConnect,
}) => {
  const [copied, setCopied] = useState(false);
  const channels = useChannels();
  const providerGroups = useMemo(() => buildProviderGroups(channels, 'text'), [channels]);
  const preset = getTextPreset(card.textPreset);
  const isGenerating = card.status === 'running' || card.status === 'queued';

  // New cards start on the first bound chat model once channel config has loaded.
  useEffect(() => {
    if (card.model || providerGroups.length === 0) return;
    const first = providerGroups[0].options.find((o) => o.ready);
    if (first) onUpdateCard(card.id, { provider: first.provider, model: first.id });
  }, [card.id, card.model, providerGroups, onUpdateCard]);

  const provider = card.provider ?? providerGroups[0]?.provider ?? 'openai';
  const currentOption = findModelOption(providerGroups, provider, card.model);

  const selectModel = (option: ModelOption) => {
    onUpdateCard(card.id, { provider: option.provider, model: option.id });
  };

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
          ? 'border-emerald-500 ring-2 ring-emerald-500/40 shadow-emerald-500/25'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
    >
      {/* Header bar (Drag Handle) */}
      <div
        onMouseDown={onStartDrag}
        className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 cursor-grab active:cursor-grabbing bg-slate-900/40 rounded-t-2xl"
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <FileText className="w-3 h-3 text-emerald-400" />
          </div>
          <input
            type="text"
            value={card.title}
            onChange={(e) => onUpdateCard(card.id, { title: e.target.value })}
            className="text-xs font-bold text-slate-100 bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-emerald-500/50 rounded px-1 max-w-[150px]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {linkedCount > 0 && (
            <span
              title="这些卡片使用本卡片的输出作为提示词"
              className="flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40"
            >
              <Link2 className="w-3 h-3" /> {linkedCount}
            </span>
          )}
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

      <div className="p-3 space-y-2.5">
        {providerGroups.length > 0 ? (
          <ProviderModelPicker
            groups={providerGroups}
            provider={provider}
            model={card.model}
            modelLabel={currentOption?.label ?? (card.model || '选择模型')}
            accent="emerald"
            onSelect={selectModel}
          />
        ) : (
          <div className="text-[10px] leading-relaxed text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl px-2.5 py-2">
            还没有可用的文本模型：
            <br />• 火山方舟：在设置里填入 API Key 保存即可，已内置 Doubao Seed 文本模型
            <br />• APIMart / GPT / Google：设置 → 渠道 → 获取模型 → 「文本」里勾选模型 → 保存并生效
          </div>
        )}

        {/* Preset: what the model is asked to write */}
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          {TEXT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onUpdateCard(card.id, { textPreset: p.id })}
              className={`py-1 rounded-lg font-semibold transition ${
                preset.id === p.id ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <textarea
          value={card.prompt}
          onChange={(e) => onUpdateCard(card.id, { prompt: e.target.value })}
          className="w-full bg-[#0b0d14] border border-slate-700/70 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none h-16 leading-relaxed"
          placeholder={preset.placeholder}
        />

        {/* Output: editable, and what linked cards use as their prompt */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-slate-400 px-0.5">
            <span>输出{linkedCount > 0 ? '（已作为提示词连到其他卡片，可直接修改）' : '（可编辑，拖右侧圆点连到生图/视频卡片）'}</span>
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
          <textarea
            value={card.textOutput ?? ''}
            onChange={(e) => onUpdateCard(card.id, { textOutput: e.target.value })}
            className="w-full bg-[#0b0d14] border border-emerald-900/60 rounded-xl p-2 text-xs text-emerald-50 focus:outline-none focus:border-emerald-500 resize-y min-h-[88px] leading-relaxed"
            placeholder="生成的文本会显示在这里"
          />
        </div>

        {card.errorMessage && (
          <div className="flex items-start gap-1 p-1.5 px-2 bg-red-950/60 border border-red-500/40 rounded-lg text-[10px] text-red-300">
            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span className="break-all">{card.errorMessage}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => onTriggerGenerate(card.id)}
          disabled={isGenerating || !card.model || !card.prompt.trim()}
          className="w-full py-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-600/25 transition active:scale-98 disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中…
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" /> 生成{preset.id === 'free' ? '回答' : preset.label}
            </>
          )}
        </button>
      </div>

      <OutputPort color="emerald" onStart={onStartConnect} />
    </div>
  );
};
