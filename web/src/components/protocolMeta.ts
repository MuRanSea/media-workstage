import {
  Bot,
  Building,
  Clapperboard,
  Network,
  Palette,
  Sparkles,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import type { Protocol } from '../services/api.ts';

/** Settings copy and fields for every provider speaking a protocol. */
export interface ProtocolMeta {
  /** Short protocol name for badges and pickers. */
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
  // Whether a generation adapter exists yet; protocols without one only store credentials.
  adapterReady: boolean;
}

export const PROTOCOL_META: Record<Protocol, ProtocolMeta> = {
  ark: {
    label: '火山方舟原生',
    title: '火山方舟原生 API',
    subtitle: 'Seedance 视频 • Seedream 生图 • Doubao Seed 文本',
    icon: Sparkles,
    accent: { text: 'text-pink-400', key: 'text-pink-300', focus: 'focus:border-pink-500' },
    baseUrlPlaceholder: 'https://ark.cn-beijing.volces.com/api/v3',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入您的火山方舟 API Key (Bearer 令牌)',
    adapterReady: true,
  },
  minimax: {
    label: 'MiniMax',
    title: 'MiniMax 海螺官方 API',
    subtitle: 'MiniMax-H3 2K 视频生成 • Video-01',
    icon: Building,
    accent: { text: 'text-indigo-400', key: 'text-indigo-300', focus: 'focus:border-indigo-500' },
    baseUrlPlaceholder: 'https://api.minimax.chat/v1',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入您的 MiniMax API Key',
    extraFields: [{ key: 'group_id', label: 'Group ID (可选)', placeholder: '仅企业/多租户账号需要填' }],
    adapterReady: true,
  },
  kling: {
    label: '可灵',
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
  midjourney: {
    label: 'MJ Proxy',
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
  gemini: {
    label: 'Gemini',
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
  openai_compatible: {
    label: 'OpenAI 兼容',
    title: 'OpenAI 兼容 API',
    subtitle: '生图 /images/generations • 文本 /chat/completions',
    icon: Bot,
    accent: { text: 'text-orange-400', key: 'text-orange-300', focus: 'focus:border-orange-500' },
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    keyLabel: 'API Key',
    keyPlaceholder: '请输入 API Key (sk-...)',
    hint: '官方地址或 OpenAI 兼容中转均可，Base URL 需包含 /v1。',
    adapterReady: true,
  },
  apimart: {
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
};

/** Protocols users can add custom providers for (the backend enforces the same list). */
export const CREATABLE_PROTOCOLS: Protocol[] = ['openai_compatible'];
