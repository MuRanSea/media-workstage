import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ProviderId } from '../../services/api.ts';
import type { ModelOption, ProviderGroup } from '../../engine/channelModels.ts';
import { providerName } from '../../engine/providers.ts';

type Accent = 'pink' | 'indigo' | 'emerald';

// Full class strings so Tailwind's content scan picks them up.
const ACCENTS: Record<Accent, { text: string; active: string; ring: string }> = {
  pink: { text: 'text-pink-300', active: 'bg-pink-600 text-white font-bold', ring: 'border-pink-500/60' },
  indigo: { text: 'text-indigo-300', active: 'bg-indigo-600 text-white font-bold', ring: 'border-indigo-500/60' },
  emerald: { text: 'text-emerald-300', active: 'bg-emerald-600 text-white font-bold', ring: 'border-emerald-500/60' },
};

interface ProviderModelPickerProps {
  groups: ProviderGroup[];
  provider: ProviderId;
  model: string;
  /** Shown when the card's model is not among the channel's bound models. */
  modelLabel: string;
  accent: Accent;
  onSelect: (option: ModelOption) => void;
}

/**
 * Two-step picker: choose the provider (who generates), then one of its bound models.
 * Providers without an adapter for this card type are listed but not selectable.
 */
export const ProviderModelPicker: React.FC<ProviderModelPickerProps> = ({
  groups,
  provider,
  model,
  modelLabel,
  accent,
  onSelect,
}) => {
  const [open, setOpen] = useState<'provider' | 'model' | null>(null);
  const colors = ACCENTS[accent];
  const currentGroup = groups.find((g) => g.provider === provider);
  const currentOption = currentGroup?.options.find((o) => o.id === model);

  const pickProvider = (g: ProviderGroup) => {
    if (!g.ready) return;
    if (g.provider !== provider) {
      onSelect(g.options.find((o) => o.ready) ?? g.options[0]);
      setOpen('model');
    } else {
      setOpen(null);
    }
  };

  const fieldClass = (which: 'provider' | 'model') =>
    `min-w-0 flex flex-col items-start px-2.5 py-1.5 rounded-lg border bg-canvas-bg hover:bg-slate-800/60 transition text-left ${
      open === which ? colors.ring : 'border-slate-800'
    }`;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-1">
        <button type="button" onClick={() => setOpen(open === 'provider' ? null : 'provider')} className={fieldClass('provider')}>
          <span className="text-[11px] text-slate-500">服务商</span>
          <span className={`w-full flex items-center justify-between gap-1 text-xs font-semibold ${colors.text}`}>
            <span className="truncate">{currentGroup?.name ?? providerName(provider)}</span>
            <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
          </span>
        </button>
        <button type="button" onClick={() => setOpen(open === 'model' ? null : 'model')} className={fieldClass('model')}>
          <span className="text-[11px] text-slate-500">模型</span>
          <span className={`w-full flex items-center justify-between gap-1 text-xs font-semibold ${colors.text}`}>
            <span className="truncate">{currentOption?.label ?? modelLabel}</span>
            <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
          </span>
        </button>
      </div>

      {open && (
        <div
          onWheel={(e) => e.stopPropagation()}
          className="bg-[#161925] border border-slate-700 rounded-xl p-1.5 shadow-2xl z-30 space-y-0.5 max-h-64 overflow-y-auto"
        >
          {open === 'provider' &&
            groups.map((g) => (
              <button
                key={g.provider}
                type="button"
                disabled={!g.ready}
                onClick={() => pickProvider(g)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs transition ${
                  g.provider === provider
                    ? colors.active
                    : g.ready
                    ? 'hover:bg-slate-800 text-slate-200'
                    : 'text-slate-500 cursor-not-allowed'
                }`}
              >
                <span className="truncate">{g.name}</span>
                <span className="text-[11px] opacity-70 flex-shrink-0">
                  {!g.ready
                    ? '未接入'
                    : g.options.every((o) => o.ready)
                    ? `${g.options.length} 个模型`
                    : `${g.options.filter((o) => o.ready).length}/${g.options.length} 可用`}
                </span>
              </button>
            ))}

          {open === 'model' &&
            (currentGroup ? (
              currentGroup.options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={!opt.ready}
                  onClick={() => {
                    onSelect(opt);
                    setOpen(null);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-xs transition ${
                    opt.id === model
                      ? colors.active
                      : opt.ready
                      ? 'hover:bg-slate-800 text-slate-200'
                      : 'text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <span className="truncate font-mono text-[11px]">{opt.label}</span>
                  <span className="text-[11px] opacity-70 flex-shrink-0">{opt.ready ? opt.tag : '未接入'}</span>
                </button>
              ))
            ) : (
              <div className="px-2 py-1.5 text-[11px] text-slate-400">
                该服务商没有绑定此类模型，请先在设置中绑定。
              </div>
            ))}

          <div className="px-2 pt-1 mt-0.5 border-t border-slate-800 text-[11px] text-slate-500">
            更多服务商或模型：右上角「设置」→ 选择服务商 → 绑定模型
          </div>
        </div>
      )}
    </div>
  );
};
