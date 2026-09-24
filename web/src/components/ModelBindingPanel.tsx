import React, { useMemo, useState } from 'react';
import { Boxes, CheckSquare, Loader2, Plus, Search, Square, X, DownloadCloud } from 'lucide-react';
import {
  apiListChannelModels,
  type ChannelId,
  type ChannelModel,
  type ListModelsResponse,
} from '../services/api.ts';

type BindableType = 'image' | 'video' | 'chat';
type CatalogFilter = BindableType | 'other' | 'all';

interface ModelBindingPanelProps {
  channelId: ChannelId;
  canListModels: boolean;
  /** Current form values; an empty key makes the backend fall back to the saved one. */
  baseUrl: string;
  apiKey: string;
  isConfigured: boolean;
  models: ChannelModel[];
  /** Built-in models; enables 「恢复默认」 when non-empty. */
  presets?: ChannelModel[];
  onChange: (models: ChannelModel[]) => void;
}

const TYPE_LABEL: Record<string, string> = {
  image: '图',
  video: '视频',
  chat: '文本',
  audio: '音频',
  other: '其他',
};
const OTHER_BADGE = 'bg-slate-500/15 text-slate-400 border-slate-500/30';
const TYPE_BADGE: Record<string, string> = {
  image: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  video: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  chat: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

const isBindable = (m: ChannelModel): m is ChannelModel & { type: BindableType } =>
  m.type === 'image' || m.type === 'video' || m.type === 'chat';

/**
 * Lets a channel bind the models cards may use: fetch the live catalog (or presets),
 * tick models on or off, or add an ID by hand. Changes are saved with the channel.
 */
export const ModelBindingPanel: React.FC<ModelBindingPanelProps> = ({
  channelId,
  canListModels,
  baseUrl,
  apiKey,
  isConfigured,
  models,
  presets,
  onChange,
}) => {
  const [catalog, setCatalog] = useState<{
    loading: boolean;
    error?: string;
    result?: ListModelsResponse;
  } | null>(null);
  const [filter, setFilter] = useState<CatalogFilter>('image');
  const [query, setQuery] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualType, setManualType] = useState<BindableType>('image');

  const boundIds = useMemo(() => new Set(models.map((m) => m.id)), [models]);
  const needsKey = canListModels && !apiKey.trim() && !isConfigured;

  const fetchCatalog = async () => {
    setCatalog({ loading: true });
    try {
      const result = await apiListChannelModels({
        provider: channelId,
        base_url: baseUrl.trim() || undefined,
        api_key: apiKey.trim() || undefined,
      });
      setCatalog({ loading: false, result });
    } catch (e) {
      setCatalog({ loading: false, error: (e as Error).message });
    }
  };

  const catalogModels = catalog?.result?.models ?? [];
  // Bound models the provider's live list does not contain (e.g. a relay that lacks them).
  const catalogIds = new Set(catalogModels.map((m) => m.id));
  const staleIds =
    catalog?.result?.source === 'remote'
      ? models.filter((m) => !catalogIds.has(m.id)).map((m) => m.id)
      : [];
  const staleSet = new Set(staleIds);
  const counts: Record<CatalogFilter, number> = {
    image: catalogModels.filter((m) => m.type === 'image').length,
    video: catalogModels.filter((m) => m.type === 'video').length,
    chat: catalogModels.filter((m) => m.type === 'chat').length,
    other: catalogModels.filter((m) => !isBindable(m)).length,
    all: catalogModels.length,
  };
  const q = query.trim().toLowerCase();
  const visible = catalogModels.filter((m) => {
    const inTab =
      filter === 'all' || (filter === 'other' ? !isBindable(m) : m.type === filter);
    return inTab && (!q || m.id.toLowerCase().includes(q));
  });
  // "Select all" only covers models whose type is known; untyped ones need an explicit choice.
  const visibleBindable = visible.filter(isBindable);
  const allVisibleBound =
    visibleBindable.length > 0 && visibleBindable.every((m) => boundIds.has(m.id));

  const toggle = (m: ChannelModel) => {
    onChange(boundIds.has(m.id) ? models.filter((b) => b.id !== m.id) : [...models, m]);
  };

  const bindAs = (id: string, type: BindableType) => {
    if (!boundIds.has(id)) onChange([...models, { id, type }]);
  };

  const toggleAllVisible = () => {
    if (allVisibleBound) {
      const drop = new Set(visibleBindable.map((m) => m.id));
      onChange(models.filter((b) => !drop.has(b.id)));
    } else {
      onChange([...models, ...visibleBindable.filter((m) => !boundIds.has(m.id))]);
    }
  };

  const addManual = () => {
    const id = manualId.trim();
    if (!id || boundIds.has(id)) return;
    onChange([...models, { id, type: manualType }]);
    setManualId('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5 text-slate-400" />
            <span>已绑定 {models.length} 个</span>
          </label>
          {models.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-slate-500 hover:text-red-300"
            >
              清空
            </button>
          )}
          {presets && presets.length > 0 && (
            <button
              type="button"
              onClick={() => onChange(presets)}
              title={`恢复为内置模型：${presets.map((m) => m.id).join('、')}`}
              className="text-[11px] text-slate-500 hover:text-emerald-300"
            >
              恢复默认
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={fetchCatalog}
          disabled={catalog?.loading || needsKey}
          title={needsKey ? '请先填写 API Key' : undefined}
          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-600 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition active:scale-95"
        >
          {catalog?.loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <DownloadCloud className="w-3 h-3" />
          )}
          {canListModels ? '获取模型' : '查看预设'}
        </button>
      </div>

      {/* Bound model chips */}
      {models.length === 0 ? (
        <div className="text-[11px] text-slate-500">
          {canListModels
            ? '还没有绑定模型：点右边的「获取模型」，勾选要在卡片里使用的模型。'
            : '还没有绑定模型，卡片里不会出现这个服务商。'}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {models.map((m) => (
            <span
              key={m.id}
              title={staleSet.has(m.id) ? '服务商的模型列表中没有这个模型' : undefined}
              className={`inline-flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded-md bg-canvas-bg border text-[11px] font-mono max-w-full ${
                staleSet.has(m.id) ? 'border-amber-500/60 text-amber-200 line-through decoration-amber-500/60' : 'border-slate-700 text-slate-200'
              }`}
            >
              <span className={`px-1 rounded border text-[11px] font-sans ${TYPE_BADGE[m.type] ?? ''}`}>
                {TYPE_LABEL[m.type] ?? m.type}
              </span>
              <span className="truncate">{m.id}</span>
              <button
                type="button"
                onClick={() => toggle(m)}
                title="解除绑定"
                className="p-0.5 text-slate-500 hover:text-red-300 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {staleIds.length > 0 && (
        <div className="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded-lg border bg-amber-500/10 text-amber-200 border-amber-500/30">
          <span>有 {staleIds.length} 个已绑定模型不在服务商的模型列表中（上方划线标出）</span>
          <button
            type="button"
            onClick={() => onChange(models.filter((m) => !staleSet.has(m.id)))}
            className="px-1.5 py-0.5 rounded border border-amber-500/40 hover:bg-amber-500/20 whitespace-nowrap"
          >
            全部移除
          </button>
        </div>
      )}

      {catalog?.error && (
        <div className="text-[11px] px-2 py-1 rounded-lg border bg-red-500/15 text-red-300 border-red-500/30">
          获取失败：{catalog.error}
        </div>
      )}

      {/* Fetched catalog picker */}
      {catalog?.result && (
        <div className="rounded-xl border border-slate-800 bg-canvas-bg p-2 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            {(
              [
                ['image', '图片'],
                ['video', '视频'],
                ['chat', '文本'],
                ['other', '其他'],
                ['all', '全部'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-1.5 py-0.5 rounded whitespace-nowrap ${
                  filter === key ? 'bg-slate-700 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
                <span className="ml-0.5 opacity-60">{counts[key]}</span>
              </button>
            ))}
            <div className="relative flex-1 min-w-0">
              <Search className="w-3 h-3 text-slate-500 absolute left-1.5 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索模型"
                className="w-full bg-canvas-surface border border-slate-700 rounded-md pl-5 pr-1.5 py-0.5 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-slate-500"
              />
            </div>
            <button
              type="button"
              onClick={toggleAllVisible}
              disabled={visibleBindable.length === 0}
              className="px-1.5 py-0.5 rounded text-slate-300 hover:text-white disabled:opacity-40 whitespace-nowrap"
            >
              {allVisibleBound ? '取消全选' : '全选'}
            </button>
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {visible.length === 0 ? (
              <div className="text-[11px] text-slate-500 px-1 py-2">没有匹配的模型</div>
            ) : (
              visible.map((m) => {
                const bound = models.find((b) => b.id === m.id);
                // Untyped models (chat/audio/other guesses) are bound by picking a type explicitly.
                if (!bound && !isBindable(m)) {
                  return (
                    <div key={m.id} className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-slate-800/60">
                      <Square className="w-3.5 h-3.5 text-slate-700 flex-shrink-0" />
                      <span className="flex-1 truncate text-[11px] font-mono text-slate-400">{m.id}</span>
                      <span className={`px-1 rounded border text-[11px] ${OTHER_BADGE}`}>
                        {TYPE_LABEL[m.type] ?? m.type}
                      </span>
                      <button
                        type="button"
                        onClick={() => bindAs(m.id, 'image')}
                        className="px-1 rounded border text-[11px] border-pink-500/30 text-pink-300 hover:bg-pink-500/15"
                      >
                        +图
                      </button>
                      <button
                        type="button"
                        onClick={() => bindAs(m.id, 'video')}
                        className="px-1 rounded border text-[11px] border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/15"
                      >
                        +视频
                      </button>
                      <button
                        type="button"
                        onClick={() => bindAs(m.id, 'chat')}
                        className="px-1 rounded border text-[11px] border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15"
                      >
                        +文本
                      </button>
                    </div>
                  );
                }
                const shownType = bound?.type ?? m.type;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(bound ?? m)}
                    className="w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md hover:bg-slate-800/60 text-left"
                  >
                    {bound ? (
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    )}
                    <span className="flex-1 truncate text-[11px] font-mono text-slate-200">{m.id}</span>
                    <span className={`px-1 rounded border text-[11px] ${TYPE_BADGE[shownType] ?? OTHER_BADGE}`}>
                      {TYPE_LABEL[shownType] ?? shownType}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className="text-[11px] text-slate-500 leading-relaxed">
            {catalog.result.source === 'remote' ? '来自服务商实时列表' : '该渠道没有模型列表接口，显示内置预设'}
            {` · 共 ${counts.all} 个`}
            {counts.other > 0 && `；类型未识别的 ${counts.other} 个在「其他」，可用 +图 / +视频 / +文本 绑定`}
          </div>
        </div>
      )}

      {/* Manual add */}
      <div className="flex items-center gap-1.5">
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addManual();
          }}
          placeholder="手动输入模型 ID"
          className="flex-1 min-w-0 bg-canvas-bg border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-200 focus:outline-none focus:border-slate-500"
        />
        <select
          value={manualType}
          onChange={(e) => setManualType(e.target.value as BindableType)}
          className="bg-canvas-bg border border-slate-700 rounded-lg px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none"
        >
          <option value="image">图片</option>
          <option value="video">视频</option>
          <option value="chat">文本</option>
        </select>
        <button
          type="button"
          onClick={addManual}
          disabled={!manualId.trim() || boundIds.has(manualId.trim())}
          className="p-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-600 rounded-lg text-slate-200"
          title="添加"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
