import React, { useState } from 'react';
import { AlertCircle, Globe, Key, Loader2, Plus, Tag } from 'lucide-react';
import { apiCreateProvider, type Protocol, type ProviderConfigItem, type ProviderId } from '../services/api.ts';
import { refreshChannels } from '../services/channels.ts';
import { defaultProviderName, isNameTaken } from '../engine/providers.ts';
import { CREATABLE_PROTOCOLS, PROTOCOL_META } from './protocolMeta.ts';
import { Button, Segmented, inputClass } from './ui/index.ts';

interface AddProviderPaneProps {
  providers: ProviderConfigItem[];
  onCreated: (id: ProviderId) => void;
  onCancel: () => void;
}

/** Right-hand pane of the settings modal for adding a custom provider. */
export const AddProviderPane: React.FC<AddProviderPaneProps> = ({ providers, onCreated, onCancel }) => {
  const [protocol, setProtocol] = useState<Protocol>(CREATABLE_PROTOCOLS[0]);
  const meta = PROTOCOL_META[protocol];
  const [name, setName] = useState(() => defaultProviderName(meta.label, providers));
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameTaken = isNameTaken(name, providers);
  const canCreate = !creating && name.trim() !== '' && !nameTaken && baseUrl.trim() !== '';

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const { config } = await apiCreateProvider({
        protocol,
        name: name.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim() || undefined,
      });
      await refreshChannels();
      onCreated(config.id);
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  };

  const Icon = meta.icon;
  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-5 text-xs text-slate-200">
      <div className="flex items-start gap-3">
        <Plus className="w-5 h-5 mt-0.5 flex-shrink-0 text-slate-300" />
        <div>
          <div className="text-sm font-semibold text-slate-100">添加服务商</div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            同一种接口可以添加多个，例如多个中转站；用名称区分它们，卡片里按名称选择。
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <div className="space-y-1.5">
          <span className="text-[11px] text-slate-400">接入协议</span>
          <Segmented
            value={protocol}
            onChange={(p) => {
              setProtocol(p);
              setName(defaultProviderName(PROTOCOL_META[p].label, providers));
            }}
            options={CREATABLE_PROTOCOLS.map((p) => ({ value: p, label: PROTOCOL_META[p].label }))}
          />
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Icon className={`w-3.5 h-3.5 ${meta.accent.text}`} /> {meta.subtitle}
          </p>
        </div>

        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Tag className="w-3.5 h-3.5" /> 名称
          </span>
          <input
            type="text"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} py-2 ${meta.accent.focus}`}
            placeholder="例如：中转站 A"
          />
          {nameTaken && <span className="text-[11px] text-rose-300">名称已被其他服务商使用</span>}
        </label>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Globe className="w-3.5 h-3.5" /> Base URL
          </span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className={`${inputClass} font-mono py-2 ${meta.accent.focus}`}
            placeholder={meta.baseUrlPlaceholder}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Key className="w-3.5 h-3.5" /> {meta.keyLabel}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={`${inputClass} font-mono py-2 ${meta.accent.focus}`}
            placeholder={meta.keyPlaceholder}
          />
        </label>
        {meta.hint && <p className="text-[11px] leading-relaxed text-slate-500">{meta.hint}</p>}
      </section>

      {error && (
        <p className="flex items-start gap-1 text-[11px] text-rose-300">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void create()}
          disabled={!canCreate}
          icon={creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
        >
          {creating ? '添加中…' : '添加'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <span className="text-[11px] text-slate-500">添加后可以测试连接并绑定模型。</span>
      </div>
    </div>
  );
};
