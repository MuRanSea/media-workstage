import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Globe, Info, Key, Loader2, RefreshCw } from 'lucide-react';
import { apiTestAssetUploadConfig, type UploadTarget } from '../services/uploads.ts';
import { saveUploadPlatform, useUploadPlatform } from '../services/uploadPlatform.ts';
import { Button, inputClass } from './ui/index.ts';

interface Status {
  busy: boolean;
  ok?: boolean;
  msg?: string;
}

const UploadConfigForm: React.FC<{ target: UploadTarget }> = ({ target }) => {
  const platform = useUploadPlatform(target);
  const isAsset = target === 'asset';
  const title = isAsset ? '上传素材库' : '获取链接';
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<Status>({ busy: false });
  const [save, setSave] = useState<Status>({ busy: false });

  useEffect(() => {
    if (platform) setBaseUrl(platform.base_url);
  }, [platform]);

  const trimmedUrl = baseUrl.trim().replace(/\/+$/, '');
  const dirty = !!platform && (trimmedUrl !== platform.base_url || apiKey.trim() !== '');

  const runTest = async () => {
    setTest({ busy: true });
    try {
      const res = await apiTestAssetUploadConfig({ base_url: trimmedUrl, api_key: apiKey.trim() });
      setTest({ busy: false, ok: res.ok, msg: res.message });
    } catch (e) {
      setTest({ busy: false, ok: false, msg: (e as Error).message });
    }
  };

  const runSave = async () => {
    setSave({ busy: true });
    setTest({ busy: false });
    try {
      await saveUploadPlatform(target, { base_url: trimmedUrl, api_key: apiKey.trim() });
      setApiKey('');
      setSave({ busy: false, ok: true, msg: '已保存，立即生效' });
    } catch (e) {
      setSave({ busy: false, ok: false, msg: (e as Error).message });
    }
  };

  const runClear = async () => {
    setSave({ busy: true });
    setTest({ busy: false });
    try {
      await saveUploadPlatform(target, { clear: true });
      setApiKey('');
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
    <section aria-label={title} className="space-y-3 rounded-lg border border-canvas-border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-100">{title}</h3>
          {platform && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <span className={`w-1.5 h-1.5 rounded-full ${platform.is_configured ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              {platform.is_configured ? `已配置 · ${platform.masked_key}` : '未配置'}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          {isAsset ? '上传到火山素材库，返回素材 ID（asset://…）。' : '上传到文件存储，返回 7 天有效的下载链接。'}
        </p>
      </div>
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

      <div className="flex flex-wrap items-center gap-2 border-t border-canvas-border pt-3">
        <Button
          size="sm"
          variant="primary"
          onClick={() => void runSave()}
          disabled={save.busy || test.busy || !dirty || !trimmedUrl}
          icon={save.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
        >
          {save.busy ? '保存中…' : `保存「${title}」`}
        </Button>
        {isAsset && (
          <Button
            size="sm"
            onClick={() => void runTest()}
            disabled={save.busy || test.busy || !trimmedUrl || (!apiKey.trim() && !platform?.is_configured)}
            title="只读查询一次素材列表，不上传任何文件"
            icon={test.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          >
            {test.busy ? '测试中…' : '测试连接'}
          </Button>
        )}
        {platform?.is_configured && (
          <Button size="sm" variant="ghost" className="ml-auto hover:!text-rose-300" onClick={() => void runClear()} disabled={save.busy || test.busy}>
            清除配置
          </Button>
        )}
      </div>
      {statusLine(test)}
      {statusLine(save)}
    </section>
  );
};

export const UploadPlatformPane: React.FC = () => {
  const docsUrl = useUploadPlatform('asset')?.docs_url;
  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-4 text-xs text-slate-200">
      <div className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-400">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p>分别填写两个功能的平台地址与 API Key，保存和清除互不影响，也不会修改模型服务商配置。更换地址时请填写对应的 Key。</p>
          <p>平台需要支持对应的业务接口。{docsUrl && <a href={docsUrl} target="_blank" rel="noreferrer" className="underline hover:text-slate-200">查看平台接口说明</a>}</p>
        </div>
      </div>
      <UploadConfigForm target="asset" />
      <UploadConfigForm target="file" />
    </div>
  );
};
