import React, { useState, useEffect } from 'react';
import {
  X,
  Key,
  Globe,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  Building,
  RefreshCw,
  Info,
  Plus,
  Tag,
} from 'lucide-react';
import {
  apiDeleteProvider,
  apiUpdateConfig,
  apiTestConfig,
  type BoundModel,
  type ProviderConfigItem,
  type ProviderId,
} from '../services/api.ts';
import { refreshChannels, useChannels } from '../services/channels.ts';
import { runsMockedWithoutKey } from '../engine/channelModels.ts';
import { isNameTaken } from '../engine/providers.ts';
import { AddProviderPane } from './AddProviderPane.tsx';
import { ModelBindingPanel } from './ModelBindingPanel.tsx';
import { PROTOCOL_META } from './protocolMeta.ts';
import { Button, IconButton, inputClass, useDialogs } from './ui/index.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProviderForm {
  name: string;
  // The name only follows the saved one until the user edits it.
  nameEdited: boolean;
  baseUrl: string;
  apiKey: string;
  extra: Record<string, string>;
  showKey: boolean;
  models: BoundModel[];
  // Unsaved model edits survive config reloads; only sent on save when true.
  modelsDirty: boolean;
}

interface TestStatus {
  testing: boolean;
  ok?: boolean;
  msg?: string;
}

const emptyForm = (): ProviderForm => ({
  name: '',
  nameEdited: false,
  baseUrl: '',
  apiKey: '',
  extra: {},
  showKey: false,
  models: [],
  modelsDirty: false,
});

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ProviderId>('ark');
  // The right pane shows the add-provider form instead of a provider.
  const [adding, setAdding] = useState(false);
  const providers = useChannels();
  const [forms, setForms] = useState<Record<ProviderId, ProviderForm>>({});
  const [testStatus, setTestStatus] = useState<Partial<Record<ProviderId, TestStatus>>>({});

  const [saveStatus, setSaveStatus] = useState<{ saving: boolean; success?: boolean; error?: string }>({
    saving: false,
  });
  const { confirm } = useDialogs();

  const patchForm = (id: ProviderId, patch: Partial<ProviderForm>) => {
    setForms((prev) => ({ ...prev, [id]: { ...(prev[id] ?? emptyForm()), ...patch } }));
  };

  // Sync form fields from the shared provider config whenever it reloads
  useEffect(() => {
    setForms((prev) => {
      const next = { ...prev };
      for (const p of providers) {
        const f = next[p.id] ?? emptyForm();
        next[p.id] = {
          ...f,
          name: f.nameEdited ? f.name : p.name,
          baseUrl: p.base_url || f.baseUrl,
          extra: { ...f.extra, ...p.extra },
          models: f.modelsDirty ? f.models : p.models,
        };
      }
      return next;
    });
  }, [providers]);

  useEffect(() => {
    if (isOpen) {
      void refreshChannels();
      setTestStatus({});
      setSaveStatus({ saving: false });
      setAdding(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const channel: ProviderConfigItem | undefined = providers.find((p) => p.id === activeTab) ?? providers[0];
  if (!channel) {
    // Provider config has not loaded (yet); the open effect is fetching it.
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="flex items-center gap-2 px-5 py-4 bg-canvas-surface border border-slate-700/80 rounded-2xl text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> 正在加载服务商配置…
          <IconButton title="关闭" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>
      </div>
    );
  }
  const meta = PROTOCOL_META[channel.protocol];
  const form = forms[channel.id] ?? emptyForm();
  const current = channel;
  const test = testStatus[channel.id] ?? { testing: false };
  const ChannelIcon = meta.icon;

  const handleTest = async () => {
    const id = channel.id;
    setTestStatus((prev) => ({ ...prev, [id]: { testing: true } }));
    const extra = Object.fromEntries(
      Object.entries(form.extra).filter(([, v]) => v.trim() !== '')
    );
    try {
      const res = await apiTestConfig({
        provider: id,
        base_url: form.baseUrl,
        api_key: form.apiKey,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      });
      setTestStatus((prev) => ({
        ...prev,
        [id]: {
          testing: false,
          ok: res.ok,
          msg: res.ok ? res.message || '连接与鉴权测试成功！' : res.error || '测试失败',
        },
      }));
    } catch (e) {
      setTestStatus((prev) => ({
        ...prev,
        [id]: { testing: false, ok: false, msg: (e as Error).message },
      }));
    }
  };

  // Wipe a channel that was filled in by mistake, so cards stop offering it.
  const handleClear = async () => {
    const ok = await confirm({
      title: `清除「${channel.name}」的配置？`,
      message: '会删除已保存的 API Key、Base URL 和绑定的模型，卡片里将不再出现这个服务商。',
      confirmText: '清除',
      danger: true,
    });
    if (!ok) return;
    setSaveStatus({ saving: true, success: false, error: undefined });
    try {
      await apiUpdateConfig({ provider: channel.id, clear: true });
      patchForm(channel.id, { apiKey: '', baseUrl: '', extra: {}, modelsDirty: false });
      setTestStatus((prev) => ({ ...prev, [channel.id]: { testing: false } }));
      await refreshChannels();
      setSaveStatus({ saving: false, success: true });
      setTimeout(() => setSaveStatus({ saving: false }), 3000);
    } catch (e) {
      setSaveStatus({ saving: false, error: (e as Error).message });
    }
  };

  // Save current tab configuration
  const handleSave = async () => {
    setSaveStatus({ saving: true, success: false, error: undefined });
    try {
      await apiUpdateConfig({
        provider: channel.id,
        name: nameChanged(channel.id) ? form.name.trim() : undefined,
        base_url: form.baseUrl,
        api_key: form.apiKey || undefined,
        extra: meta.extraFields
          ? Object.fromEntries(meta.extraFields.map((f) => [f.key, form.extra[f.key] ?? '']))
          : undefined,
        models: form.modelsDirty ? form.models : undefined,
      });

      // The saved key now shows masked in the placeholder.
      patchForm(channel.id, { modelsDirty: false, apiKey: '', nameEdited: false });
      await refreshChannels();
      setSaveStatus({ saving: false, success: true });
      setTimeout(() => {
        setSaveStatus({ saving: false });
      }, 3000);
    } catch (e) {
      setSaveStatus({ saving: false, error: (e as Error).message });
    }
  };

  // A custom provider cannot be cleared (it has no default base URL); it is deleted instead.
  const handleDelete = async () => {
    const ok = await confirm({
      title: `删除服务商「${channel.name}」？`,
      message: '会删除它的 API Key、Base URL 和绑定的模型。用它的卡片需要重新选择服务商，正在生成的任务会失败。',
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    setSaveStatus({ saving: true, success: false, error: undefined });
    try {
      await apiDeleteProvider(channel.id);
      setForms((prev) => {
        const next = { ...prev };
        delete next[channel.id];
        return next;
      });
      setActiveTab(providers[0]?.id ?? 'ark');
      await refreshChannels();
      setSaveStatus({ saving: false });
    } catch (e) {
      setSaveStatus({ saving: false, error: (e as Error).message });
    }
  };

  /** Whether the user renamed a provider in its form. */
  const nameChanged = (id: ProviderId) => {
    const f = forms[id];
    const saved = providers.find((p) => p.id === id);
    return !!f && !!saved && f.nameEdited && f.name.trim() !== saved.name;
  };

  /** Whether a provider's form differs from what is saved. */
  const isDirty = (id: ProviderId) => {
    const f = forms[id];
    const saved = providers.find((p) => p.id === id);
    if (!f || !saved) return false;
    if (f.apiKey.trim() || f.modelsDirty || nameChanged(id)) return true;
    if (f.baseUrl.trim() && f.baseUrl.trim() !== (saved.base_url ?? '').trim()) return true;
    return (PROTOCOL_META[saved.protocol].extraFields ?? []).some(
      (x) => (f.extra[x.key] ?? '') !== (saved.extra?.[x.key] ?? '')
    );
  };
  const dirtyProviders = providers.filter((p) => isDirty(p.id));

  const requestClose = async () => {
    if (dirtyProviders.length > 0) {
      const ok = await confirm({
        title: '放弃未保存的修改？',
        message: `${dirtyProviders.map((p) => p.name).join('、')} 有修改还没保存。`,
        confirmText: '放弃修改',
        danger: true,
      });
      if (!ok) return;
      setForms({});
    }
    onClose();
  };

  const statusFor = (p: ProviderConfigItem) => {
    if (p.is_configured) return { dot: 'bg-emerald-400', label: '已配置' };
    if (runsMockedWithoutKey(p)) return { dot: 'bg-amber-400', label: '演示模式' };
    return { dot: 'bg-slate-600', label: '未配置' };
  };
  const status = statusFor(channel);
  const mockWhenUnset = runsMockedWithoutKey(channel);
  const inputFocus = meta.accent.focus;
  const nameError = !form.name.trim()
    ? '名称不能为空'
    : isNameTaken(form.name, providers, channel.id)
    ? '名称已被其他服务商使用'
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none"
      onMouseDown={(e) => e.target === e.currentTarget && void requestClose()}
    >
      <div className="relative w-full max-w-3xl max-h-[calc(100vh-2rem)] flex flex-col bg-canvas-surface border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 overflow-hidden">
        <div className="flex items-center justify-between px-5 h-14 border-b border-canvas-border flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">服务商设置</h2>
            <p className="text-[11px] text-slate-500">填写各家服务的 API Key，并选择卡片里可以用的模型</p>
          </div>
          <IconButton title="关闭" onClick={() => void requestClose()}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        <div className="flex flex-col sm:flex-row flex-1 min-h-0">
          <nav className="flex sm:flex-col gap-0.5 p-2 sm:w-48 flex-shrink-0 overflow-x-auto sm:overflow-y-auto border-b sm:border-b-0 sm:border-r border-canvas-border bg-canvas-bg/60 text-xs">
            {providers.map((c, i) => {
              const cMeta = PROTOCOL_META[c.protocol];
              const Icon = cMeta.icon;
              const active = !adding && c.id === channel.id;
              const st = statusFor(c);
              const firstCustom = !c.preset && (i === 0 || providers[i - 1].preset);
              return (
                <React.Fragment key={c.id}>
                  {firstCustom && (
                    <div className="hidden sm:block px-2.5 pt-3 pb-1 text-[11px] text-slate-500">自定义</div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab(c.id);
                      setAdding(false);
                    }}
                    title={`${cMeta.label} · ${st.label}`}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left whitespace-nowrap transition ${
                      active ? `bg-slate-800 ${cMeta.accent.text} font-semibold` : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{c.name}</span>
                      <span className="hidden sm:block truncate text-[11px] font-normal text-slate-500">{cMeta.label}</span>
                    </span>
                    {isDirty(c.id) && <span className="text-[11px] font-normal text-amber-300">未保存</span>}
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                  </button>
                </React.Fragment>
              );
            })}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={`flex items-center gap-2 px-2.5 py-2 mt-1 rounded-lg text-left whitespace-nowrap border border-dashed transition ${
                adding
                  ? 'border-slate-500 bg-slate-800 text-slate-100 font-semibold'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
              }`}
            >
              <Plus className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 truncate">添加服务商</span>
            </button>
          </nav>

          {adding ? (
            <AddProviderPane
              providers={providers}
              onCreated={(id) => {
                setActiveTab(id);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <div key={channel.id} className="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-5 text-xs text-slate-200">
              <div className="flex items-start gap-3">
                <ChannelIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${meta.accent.text}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="text-sm font-semibold text-slate-100">{channel.name}</span>
                    <span className="text-[11px] text-slate-500">{meta.title}</span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                      {status.label}
                      {current.is_configured && current.masked_key ? ` · ${current.masked_key}` : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{meta.subtitle}</p>
                </div>
              </div>

              {(meta.hint || !meta.adapterReady || (mockWhenUnset && !current.is_configured)) && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-canvas-border text-[11px] leading-relaxed text-slate-400">
                  <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div className="space-y-0.5">
                    {mockWhenUnset && !current.is_configured && (
                      <div className="text-amber-200">演示模式：还没有填 Key，生成会返回示例图，不会产生费用。</div>
                    )}
                    {meta.hint && <div>{meta.hint}</div>}
                    {!meta.adapterReady && <div>这个服务商目前只保存配置和模型，卡片还不能用它生成。</div>}
                  </div>
                </div>
              )}

              <section className="space-y-3">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">连接</h3>
                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Tag className="w-3.5 h-3.5" /> 名称
                    <span className="text-slate-500">· 卡片里按名称选择服务商</span>
                  </span>
                  <input
                    type="text"
                    value={form.name}
                    maxLength={40}
                    onChange={(e) => patchForm(channel.id, { name: e.target.value, nameEdited: true })}
                    className={`${inputClass} py-2 ${inputFocus}`}
                  />
                  {form.nameEdited && nameError && <span className="text-[11px] text-rose-300">{nameError}</span>}
                </label>
                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Globe className="w-3.5 h-3.5" /> Base URL
                  </span>
                  <input
                    type="text"
                    value={form.baseUrl}
                    onChange={(e) => patchForm(channel.id, { baseUrl: e.target.value })}
                    className={`${inputClass} font-mono py-2 ${inputFocus}`}
                    placeholder={meta.baseUrlPlaceholder}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Key className="w-3.5 h-3.5" /> {meta.keyLabel}
                  </span>
                  <div className="relative">
                    <input
                      type={form.showKey ? 'text' : 'password'}
                      value={form.apiKey}
                      onChange={(e) => patchForm(channel.id, { apiKey: e.target.value })}
                      className={`${inputClass} font-mono py-2 pr-10 ${inputFocus}`}
                      placeholder={current.is_configured ? `已保存 ${current.masked_key}，输入新的 Key 可替换` : meta.keyPlaceholder}
                    />
                    <button
                      type="button"
                      title={form.showKey ? '隐藏' : '显示'}
                      onClick={() => patchForm(channel.id, { showKey: !form.showKey })}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
                    >
                      {form.showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </label>
                {meta.extraFields?.map((field) => (
                  <label key={field.key} className="block space-y-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                      <Building className="w-3.5 h-3.5" /> {field.label}
                    </span>
                    <input
                      type="text"
                      value={form.extra[field.key] ?? ''}
                      onChange={(e) => patchForm(channel.id, { extra: { ...form.extra, [field.key]: e.target.value } })}
                      className={`${inputClass} font-mono py-2 ${inputFocus}`}
                      placeholder={field.placeholder}
                    />
                  </label>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    onClick={handleTest}
                    disabled={test.testing || !form.apiKey || !form.baseUrl.trim()}
                    title={!form.apiKey ? '填写新的 API Key 后可以测试' : undefined}
                    icon={test.testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  >
                    {test.testing ? '测试中…' : '测试连接'}
                  </Button>
                  {test.msg && (
                    <span className={`flex items-center gap-1 min-w-0 text-[11px] ${test.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {test.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                      <span className="break-all">{test.msg}</span>
                    </span>
                  )}
                  {channel.preset && current.is_configured && (
                    <Button size="sm" variant="ghost" className="ml-auto hover:!text-rose-300" onClick={handleClear} disabled={saveStatus.saving}>
                      清除配置
                    </Button>
                  )}
                  {!channel.preset && (
                    <Button size="sm" variant="ghost" className="ml-auto hover:!text-rose-300" onClick={handleDelete} disabled={saveStatus.saving}>
                      删除服务商
                    </Button>
                  )}
                </div>
              </section>

              <section className="space-y-3 pt-4 border-t border-canvas-border">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">模型</h3>
                  <p className="mt-1 text-[11px] text-slate-500">卡片的模型下拉里只会出现这里绑定的模型。</p>
                </div>
                <ModelBindingPanel
                  key={channel.id}
                  providerId={channel.id}
                  canListModels={current.can_list_models ?? false}
                  baseUrl={form.baseUrl}
                  apiKey={form.apiKey}
                  isConfigured={current.is_configured ?? false}
                  models={form.models}
                  presets={current.presets}
                  onChange={(models) => patchForm(channel.id, { models, modelsDirty: true })}
                />
              </section>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 h-14 border-t border-canvas-border flex-shrink-0">
          <div className="min-w-0 text-[11px]">
            {adding ? null : saveStatus.error ? (
              <span className="text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> 操作失败：{saveStatus.error}
              </span>
            ) : saveStatus.success ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已保存，立即生效
              </span>
            ) : isDirty(channel.id) ? (
              <span className="text-amber-300">「{channel.name}」有未保存的修改</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="ghost" onClick={() => void requestClose()}>
              关闭
            </Button>
            {!adding && (
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={saveStatus.saving || !isDirty(channel.id) || (form.nameEdited && !!nameError)}
                icon={saveStatus.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
              >
                {saveStatus.saving ? '保存中…' : `保存「${channel.name}」`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
