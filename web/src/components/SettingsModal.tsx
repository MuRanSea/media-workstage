import React, { useState, useEffect } from 'react';
import {
  Settings,
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
    if (!window.confirm(`确定清除「${channel.label}」的 API Key、Base URL 和绑定模型吗？`)) return;
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

      patchForm(channel.id, { modelsDirty: false });
      await refreshChannels();
      setSaveStatus({ saving: false, success: true });
      setTimeout(() => {
        setSaveStatus({ saving: false });
      }, 3000);
    } catch (e) {
      setSaveStatus({ saving: false, error: (e as Error).message });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md select-none animate-in fade-in duration-150">
      <div className="relative w-full max-w-3xl bg-[#12141e]/98 border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/90 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <div className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Settings className="w-4 h-4" />
            </div>
            <span>服务商与密钥配置 (Provider Settings)</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row">
          {/* Channel Navigation */}
          <nav className="flex sm:flex-col gap-1 p-2 sm:w-44 flex-shrink-0 overflow-x-auto border-b sm:border-b-0 sm:border-r border-slate-800 bg-[#0d0f18] text-xs font-semibold">
            {CHANNELS.map((c) => {
              const Icon = c.icon;
              const active = c.id === channel.id;
              const configured = providers.find((p) => p.id === c.id)?.is_configured;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveTab(c.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-left whitespace-nowrap transition ${
                    active
                      ? `bg-slate-800/80 ${c.accent.text} font-bold`
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1 truncate">{c.label}</span>
                  {configured && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
                </button>
              );
            })}
          </nav>

          {/* Modal Body Form */}
          <div
            key={channel.id}
            className="flex-1 min-w-0 p-5 space-y-3.5 text-xs text-slate-200 max-h-[60vh] overflow-y-auto animate-in fade-in duration-100"
          >
            {/* Status info chip */}
            <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#0b0d14] border border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <ChannelIcon className={`w-4 h-4 flex-shrink-0 ${channel.accent.text}`} />
                <div className="min-w-0">
                  <div className="font-semibold text-slate-200">{channel.title}</div>
                  <div className="text-[10px] text-slate-400 font-mono truncate">{channel.subtitle}</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-mono flex-shrink-0">
                {current?.is_configured ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> 已配置 ({current.masked_key})
                  </span>
                ) : channel.mockWhenUnset ? (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    测试桩模式 (Mock)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-300 border border-slate-500/30">
                    未配置
                  </span>
                )}
              </div>
            </div>

            {(channel.hint || !channel.adapterReady) && (
              <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-xl bg-slate-800/40 border border-slate-800 text-[10px] leading-relaxed text-slate-400">
                <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  {channel.hint && <div>{channel.hint}</div>}
                  {!channel.adapterReady && <div>该渠道目前只保存配置和绑定模型，生成卡片尚未接入。</div>}
                </div>
              </div>
            )}

            {/* Base URL Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-slate-400" />
                <span>Base URL</span>
              </label>
              <input
                type="text"
                value={form.baseUrl}
                onChange={(e) => patchForm(channel.id, { baseUrl: e.target.value })}
                className={`w-full bg-[#0b0d14] border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none ${channel.accent.focus} transition`}
                placeholder={channel.baseUrlPlaceholder}
              />
            </div>

            {/* API Key Input */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-slate-400" />
                <span>{channel.keyLabel}</span>
              </label>
              <div className="relative">
                <input
                  type={form.showKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChange={(e) => patchForm(channel.id, { apiKey: e.target.value })}
                  className={`w-full bg-[#0b0d14] border border-slate-700 rounded-xl px-3 py-2 pr-10 text-xs font-mono ${channel.accent.key} focus:outline-none ${channel.accent.focus} transition`}
                  placeholder={
                    current?.is_configured
                      ? `当前使用: ${current.masked_key} (输入新密钥以更新)`
                      : channel.keyPlaceholder
                  }
                />
                <button
                  type="button"
                  onClick={() => patchForm(channel.id, { showKey: !form.showKey })}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                >
                  {form.showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Channel-specific extra fields */}
            {channel.extraFields?.map((field) => (
              <div key={field.key} className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-slate-400" />
                  <span>{field.label}</span>
                </label>
                <input
                  type="text"
                  value={form.extra[field.key] ?? ''}
                  onChange={(e) =>
                    patchForm(channel.id, { extra: { ...form.extra, [field.key]: e.target.value } })
                  }
                  className={`w-full bg-[#0b0d14] border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none ${channel.accent.focus} transition`}
                  placeholder={field.placeholder}
                />
              </div>
            ))}

            {/* Test Connection Button & Status */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={test.testing || !form.apiKey || !form.baseUrl.trim()}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-600 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 flex-shrink-0"
              >
                {test.testing ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" /> 测试中...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" /> 测试连接
                  </>
                )}
              </button>

              {test.msg && (
                <div
                  className={`text-[10px] px-2 py-1 rounded-lg border flex items-center gap-1 min-w-0 ${
                    test.ok
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-red-500/15 text-red-300 border-red-500/30'
                  }`}
                >
                  {test.ok ? (
                    <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className="truncate">{test.msg}</span>
                </div>
              )}

              {current?.is_configured && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={saveStatus.saving}
                  title="删除该渠道已保存的 API Key、Base URL 和绑定模型"
                  className="ml-auto px-2.5 py-1.5 text-[11px] text-slate-400 hover:text-red-300 border border-slate-700 hover:border-red-500/50 rounded-xl transition flex-shrink-0"
                >
                  清除配置
                </button>
              )}
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
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800 bg-slate-900/40">
          <div className="text-[11px] text-slate-400 font-mono">
            {saveStatus.success && (
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 设置已保存并持久化！
              </span>
            )}
            {saveStatus.error && (
              <span className="text-red-400 font-semibold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> 保存失败: {saveStatus.error}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveStatus.saving}
              className="px-4 py-1.5 bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 transition active:scale-95"
            >
              {saveStatus.saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 保存中...
                </>
              ) : (
                <>保存并生效</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
