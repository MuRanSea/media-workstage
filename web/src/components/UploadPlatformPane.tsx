import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Globe, Info, Key, Loader2, RefreshCw, UploadCloud } from 'lucide-react';
import { apiSaveUploadConfig, apiTestUploadConfig } from '../services/uploads.ts';
import { refreshUploadPlatform, useUploadPlatform } from '../services/uploadPlatform.ts';
import { Button, inputClass } from './ui/index.ts';

interface Status {
  busy: boolean;
  ok?: boolean;
  msg?: string;
}

/**
 * Right-hand pane of the settings modal for the Upload Platform: the Heighliner
 * business API that upload cards send files to (asset library and 7-day file links).
 * It has its own address and key, separate from every provider.
 */
export const UploadPlatformPane: React.FC = () => {
  const platform = useUploadPlatform();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<Status>({ busy: false });
  const [save, setSave] = useState<Status>({ busy: false });

  useEffect(() => {
    void refreshUploadPlatform();
  }, []);
  useEffect(() => {
    if (platform) setBaseUrl(platform.base_url);
  }, [platform]);

  const trimmedUrl = baseUrl.trim().replace(/\/+$/, '');
  const dirty = !!platform && (trimmedUrl !== platform.base_url || apiKey.trim() !== '');

  const runTest = async () => {
    setTest({ busy: true });
    try {
      const res = await apiTestUploadConfig({ base_url: trimmedUrl, api_key: apiKey.trim() });
      setTest({ busy: false, ok: res.ok, msg: res.message });
    } catch (e) {
      setTest({ busy: false, ok: false, msg: (e as Error).message });
    }
  };

  const runSave = async () => {
    setSave({ busy: true });
    try {
      await apiSaveUploadConfig({ base_url: trimmedUrl, api_key: apiKey.trim() });
      setApiKey('');
      await refreshUploadPlatform();
      setSave({ busy: false, ok: true, msg: '已保存，立即生效' });
    } catch (e) {
      setSave({ busy: false, ok: false, msg: (e as Error).message });
    }
  };

  const runClear = async () => {
    setSave({ busy: true });
    try {
      await apiSaveUploadConfig({ clear: true });
      setApiKey('');
      await refreshUploadPlatform();
      setSave({ busy: false, ok: true, msg: '已清除' });
    } catch (e) {
      setSave({ busy: false, ok: false, msg: (e as Error).message });
    }
  };

  const statusLine = (s: Status) =>
    s.msg && (
      <span className={`flex items-center gap-1 min-w-0 text-[11px] ${s.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
        {s.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
        <span className="break-all">{s.msg}</span>
      </span>
    );

  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-5 text-xs text-slate-200">
      <div className="flex items-start gap-3">
        <UploadCloud className="w-5 h-5 mt-0.5 flex-shrink-0 text-slate-300" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="text-sm font-semibold text-slate-100">上传平台</span>
            <span className="text-[11px] text-slate-500">Heighliner 平台业务 API</span>
            {platform && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <span className={`w-1.5 h-1.5 rounded-full ${platform.is_configured ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {platform.is_configured ? `已配置 · ${platform.masked_key}` : '未配置'}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">上传卡片的「上传素材库」和「获取链接」都走这里，和服务商设置互不影响。</p>
        </div>
      </div>

      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-canvas-border text-[11px] leading-relaxed text-slate-400">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <div className="space-y-0.5">
          <div>
            <span className="text-slate-300">上传素材库</span>：进入企业绑定的火山素材库，返回 <span className="font-mono">asset://</span> 素材 ID，审核通过后只有
            Seedance 能用。
          </div>
          <div>
            <span className="text-slate-300">获取链接</span>：存到平台存储，返回 7 天有效的下载地址，给只收链接的模型用。
          </div>
          <div>两者都不消耗模型额度。</div>
          {platform && (
            <div>
              接口说明：
              <a href={platform.docs_url} target="_blank" rel="noreferrer" className="font-mono underline hover:text-slate-200 break-all">
                {platform.docs_url}
              </a>
              （「平台业务 API」一节）
            </div>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">连接</h3>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Globe className="w-3.5 h-3.5" /> 平台地址
            <span className="text-slate-500">· 只用域名，接口路径 /api/… 自动补上</span>
          </span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className={`${inputClass} font-mono py-2`}
            placeholder="https://platform.sgt.site"
            spellCheck={false}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Key className="w-3.5 h-3.5" /> API Key
          </span>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={`${inputClass} font-mono py-2 pr-10`}
              placeholder={platform?.is_configured ? `已保存 ${platform.masked_key}，输入新的 Key 可替换` : '平台虚拟密钥 sk-…'}
              spellCheck={false}
            />
            <button
              type="button"
              title={showKey ? '隐藏' : '显示'}
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
            >
              {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void runTest()}
            disabled={test.busy || !trimmedUrl || (!apiKey.trim() && !platform?.is_configured)}
            title="只读查询一次素材列表，不上传任何文件"
            icon={test.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          >
            {test.busy ? '测试中…' : '测试连接'}
          </Button>
          {statusLine(test)}
          {platform?.is_configured && (
            <Button size="sm" variant="ghost" className="ml-auto hover:!text-rose-300" onClick={() => void runClear()} disabled={save.busy}>
              清除配置
            </Button>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-canvas-border">
        <Button
          variant="primary"
          onClick={() => void runSave()}
          disabled={save.busy || !dirty || !trimmedUrl}
          icon={save.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
        >
          {save.busy ? '保存中…' : '保存上传平台'}
        </Button>
        {statusLine(save)}
      </div>
    </div>
  );
};
