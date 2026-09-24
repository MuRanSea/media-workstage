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
  Sparkles,
  Building,
  RefreshCw,
  Clapperboard,
  Palette,
  WandSparkles,
  Bot,
  Network,
  Info,
  type LucideIcon,
} from 'lucide-react';
import {
  apiUpdateConfig,
  apiTestConfig,
  type ChannelId,
  type ChannelModel,
} from '../services/api.ts';
import { refreshChannels, useChannels } from '../services/channels.ts';
import { ModelBindingPanel } from './ModelBindingPanel.tsx';
import { Button, IconButton, inputClass, useDialogs } from './ui/index.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChannelMeta {
  id: ChannelId;
  label: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  // Full class strings so Tailwind's content scan picks them up.
  accent: { text: string; key: string; focus: string };
  baseUrlPlaceholder: string;
  keyLabel: string;
  keyPlaceholder: string;
  extraFields?: { key: string; label: string; placeholder: string }[];
  hint?: string;
  // Whether a generation adapter exists yet; channels without one only store credentials.
  adapterReady: boolean;
  // Ark and MiniMax run against a mock adapter until a key is saved.
  mockWhenUnset?: boolean;
}

const CHANNELS: ChannelMeta[] = [
  {
    id: 'ark',
    label: '火山方舟',
    title: '火山方舟原生 API',
    subtitle: 'Seedance 视频 • Seedream 生图 • Doubao Seed 文本',
    icon: Sparkles,
    accent: { text: 'text-pink-400', key: 'text-pink-300', focus: 'focus:border-pink-500' },
    baseUrlPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入您的火山方舟 API Key (Bearer 令牌)',
    adapterReady: true,
    mockWhenUnset: true,
  },
  {
    id: 'minimax',
    label: 'MiniMax 海螺',
    title: 'MiniMax 海螺官方 API',
    subtitle: 'MiniMax-H3 2K 视频生成 • Video-01',
    icon: Building,
    accent: { text: 'text-indigo-400', key: 'text-indigo-300', focus: 'focus:border-indigo-500' },
    baseUrlPlaceholder: 'https://api.minimax.chat/v1',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入您的 MiniMax API Key',
    extraFields: [{ key: 'group_id', label: 'Group ID (可选)', placeholder: '仅企业/多租户账号需要填' }],
    adapterReady: true,
    mockWhenUnset: true,
  },
  {
    id: 'kling',
    label: '可灵 Kling',
    title: '可灵 AI 开放平台',
    subtitle: 'Kling 3.0 / Omni 视频生成 • Kling Image 生图',
    icon: Clapperboard,
    accent: { text: 'text-teal-400', key: 'text-teal-300', focus: 'focus:border-teal-500' },
    baseUrlPlaceholder: 'https://api-beijing.klingai.com',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入可灵控制台创建的 API Key',
    hint: '默认中国区域名；国际区账号请改用国际站文档给出的域名。',
    adapterReady: false,
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    title: 'Midjourney (MJ Proxy)',
    subtitle: 'Imagine / Niji 生图 • midjourney-proxy 协议',
    icon: Palette,
    accent: { text: 'text-violet-400', key: 'text-violet-300', focus: 'focus:border-violet-500' },
    baseUrlPlaceholder: 'https://your-mj-proxy.example.com',
    keyLabel: 'API Secret',
    keyPlaceholder: '请输入 mj-api-secret 或中转令牌',
    hint: 'Midjourney 无官方 API，请填写兼容 /mj 接口的代理或中转地址（不含 /mj），支持内网与本机地址。',
    adapterReady: false,
  },
  {
    id: 'google',
    label: 'Google 生图',
    title: 'Google Gemini API',
    subtitle: 'Gemini 3 Pro Image • Gemini 3.1 Flash Image (Nano Banana)',
    icon: WandSparkles,
    accent: { text: 'text-sky-400', key: 'text-sky-300', focus: 'focus:border-sky-500' },
    baseUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入 Google AI Studio 的 Gemini API Key',
    hint: '密钥通过 x-goog-api-key 请求头发送；也可以填写中转地址（含内网），Base URL 需以 /v1beta 结尾，如 http://host:3000/v1beta。',
    adapterReady: true,
  },
  {
    id: 'openai',
    label: 'GPT 生图',
    title: 'OpenAI Images API',
    subtitle: 'gpt-image-2.5 Sunburst / Flare • gpt-image-2',
    icon: Bot,
    accent: { text: 'text-orange-400', key: 'text-orange-300', focus: 'focus:border-orange-500' },
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入 OpenAI API Key (sk-...)',
    hint: '官方地址或 OpenAI 兼容中转均可，Base URL 需包含 /v1。',
    adapterReady: true,
  },
  {
    id: 'apimart',
    label: 'APIMart',
    title: 'APIMart 聚合 API',
    subtitle: '生图 • 可灵视频 • GPT / Claude / Gemini / DeepSeek 等文本模型',
    icon: Network,
    accent: { text: 'text-lime-400', key: 'text-lime-300', focus: 'focus:border-lime-500' },
    baseUrlPlaceholder: 'https://api.apimart.ai/v1',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入 APIMart 令牌 (sk-...)',
    hint: '一个令牌可调用多家模型，模型 ID 以 APIMart 文档为准；Base URL 需包含 /v1。',
    adapterReady: true,
  },
];

interface ChannelForm {
  baseUrl: string;
  apiKey: string;
  extra: Record<string, string>;
  showKey: boolean;
  models: ChannelModel[];
  // Unsaved model edits survive config reloads; only sent on save when true.
  modelsDirty: boolean;
}

interface TestStatus {
  testing: boolean;
  ok?: boolean;
  msg?: string;
}

const initialForms = (): Record<ChannelId, ChannelForm> => {
  const forms = {} as Record<ChannelId, ChannelForm>;
  for (const c of CHANNELS) {
    forms[c.id] = { baseUrl: '', apiKey: '', extra: {}, showKey: false, models: [], modelsDirty: false };
  }
  return forms;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<ChannelId>('ark');
  const providers = useChannels();
  const [forms, setForms] = useState<Record<ChannelId, ChannelForm>>(initialForms);
  const [testStatus, setTestStatus] = useState<Partial<Record<ChannelId, TestStatus>>>({});

  const [saveStatus, setSaveStatus] = useState<{ saving: boolean; success?: boolean; error?: string }>({
    saving: false,
  });
  const { confirm } = useDialogs();

  const patchForm = (id: ChannelId, patch: Partial<ChannelForm>) => {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  // Sync form fields from the shared channel config whenever it reloads
  useEffect(() => {
    setForms((prev) => {
      const next = { ...prev };
      for (const p of providers) {
        if (!next[p.id]) continue;
        next[p.id] = {
          ...next[p.id],
          baseUrl: p.base_url || next[p.id].baseUrl,
          extra: { ...next[p.id].extra, ...p.extra },
          models: next[p.id].modelsDirty ? next[p.id].models : p.models,
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
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const channel = CHANNELS.find((c) => c.id === activeTab) ?? CHANNELS[0];
  const form = forms[channel.id];
  const current = providers.find((p) => p.id === channel.id);
  const test = testStatus[channel.id] ?? { testing: false };
  const ChannelIcon = channel.icon;

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
      title: `清除「${channel.label}」的配置？`,
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
        base_url: form.baseUrl,
        api_key: form.apiKey || undefined,
        extra: channel.extraFields
          ? Object.fromEntries(channel.extraFields.map((f) => [f.key, form.extra[f.key] ?? '']))
          : undefined,
        models: form.modelsDirty ? form.models : undefined,
      });

      // The saved key now shows masked in the placeholder.
      patchForm(channel.id, { modelsDirty: false, apiKey: '' });
      await refreshChannels();
      setSaveStatus({ saving: false, success: true });
      setTimeout(() => {
        setSaveStatus({ saving: false });
      }, 3000);
    } catch (e) {
      setSaveStatus({ saving: false, error: (e as Error).message });
    }
  };

  /** Whether a channel's form differs from what is saved. */
  const isDirty = (id: ChannelId) => {
    const f = forms[id];
    const saved = providers.find((p) => p.id === id);
    const meta = CHANNELS.find((c) => c.id === id);
    if (!f) return false;
    if (f.apiKey.trim() || f.modelsDirty) return true;
    if (f.baseUrl.trim() && f.baseUrl.trim() !== (saved?.base_url ?? '').trim()) return true;
    return (meta?.extraFields ?? []).some((x) => (f.extra[x.key] ?? '') !== (saved?.extra?.[x.key] ?? ''));
  };
  const dirtyChannels = CHANNELS.filter((c) => isDirty(c.id));

  const requestClose = async () => {
    if (dirtyChannels.length > 0) {
      const ok = await confirm({
        title: '放弃未保存的修改？',
        message: `${dirtyChannels.map((c) => c.label).join('、')} 有修改还没保存。`,
        confirmText: '放弃修改',
        danger: true,
      });
      if (!ok) return;
      setForms(initialForms());
    }
    onClose();
  };

  const statusFor = (id: ChannelId, mock?: boolean) => {
    if (providers.find((x) => x.id === id)?.is_configured) return { dot: 'bg-emerald-400', label: '已配置' };
    if (mock) return { dot: 'bg-amber-400', label: '演示模式' };
    return { dot: 'bg-slate-600', label: '未配置' };
  };
  const status = statusFor(channel.id, channel.mockWhenUnset);
  const inputFocus = channel.accent.focus;

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
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              const active = c.id === channel.id;
              const st = statusFor(c.id, c.mockWhenUnset);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveTab(c.id)}
                  title={st.label}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left whitespace-nowrap transition ${
                    active ? `bg-slate-800 ${c.accent.text} font-semibold` : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 truncate">{c.label}</span>
                  {isDirty(c.id) && <span className="text-[11px] font-normal text-amber-300">未保存</span>}
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
                </button>
              );
            })}
          </nav>

          <div key={channel.id} className="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-5 text-xs text-slate-200">
            <div className="flex items-start gap-3">
              <ChannelIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${channel.accent.text}`} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="text-sm font-semibold text-slate-100">{channel.title}</span>
                  <span className="flex items-center gap-1 text-[11px] text-slate-400">
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                    {current?.is_configured && current.masked_key ? ` · ${current.masked_key}` : ''}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{channel.subtitle}</p>
              </div>
            </div>

            {(channel.hint || !channel.adapterReady || (channel.mockWhenUnset && !current?.is_configured)) && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-canvas-border text-[11px] leading-relaxed text-slate-400">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  {channel.mockWhenUnset && !current?.is_configured && (
                    <div className="text-amber-200">演示模式：还没有填 Key，生成会返回示例图，不会产生费用。</div>
                  )}
                  {channel.hint && <div>{channel.hint}</div>}
                  {!channel.adapterReady && <div>这个服务商目前只保存配置和模型，卡片还不能用它生成。</div>}
                </div>
              </div>
            )}

            <section className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">连接</h3>
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Globe className="w-3.5 h-3.5" /> Base URL
                </span>
                <input
                  type="text"
                  value={form.baseUrl}
                  onChange={(e) => patchForm(channel.id, { baseUrl: e.target.value })}
                  className={`${inputClass} font-mono py-2 ${inputFocus}`}
                  placeholder={channel.baseUrlPlaceholder}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Key className="w-3.5 h-3.5" /> {channel.keyLabel}
                </span>
                <div className="relative">
                  <input
                    type={form.showKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(e) => patchForm(channel.id, { apiKey: e.target.value })}
                    className={`${inputClass} font-mono py-2 pr-10 ${inputFocus}`}
                    placeholder={current?.is_configured ? `已保存 ${current.masked_key}，输入新的 Key 可替换` : channel.keyPlaceholder}
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
              {channel.extraFields?.map((field) => (
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
                {current?.is_configured && (
                  <Button size="sm" variant="ghost" className="ml-auto hover:!text-rose-300" onClick={handleClear} disabled={saveStatus.saving}>
                    清除配置
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
                channelId={channel.id}
                canListModels={current?.can_list_models ?? false}
                baseUrl={form.baseUrl}
                apiKey={form.apiKey}
                isConfigured={current?.is_configured ?? false}
                models={form.models}
                presets={current?.presets}
                onChange={(models) => patchForm(channel.id, { models, modelsDirty: true })}
              />
            </section>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 h-14 border-t border-canvas-border flex-shrink-0">
          <div className="min-w-0 text-[11px]">
            {saveStatus.error ? (
              <span className="text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> 保存失败：{saveStatus.error}
              </span>
            ) : saveStatus.success ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已保存，立即生效
              </span>
            ) : isDirty(channel.id) ? (
              <span className="text-amber-300">「{channel.label}」有未保存的修改</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button variant="ghost" onClick={() => void requestClose()}>
              关闭
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saveStatus.saving || !isDirty(channel.id)}
              icon={saveStatus.saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
            >
              {saveStatus.saving ? '保存中…' : `保存「${channel.label}」`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
