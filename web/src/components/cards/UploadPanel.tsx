import React, { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, Upload } from 'lucide-react';
import type { SpatialCard } from '../../types/canvas.ts';
import { apiAssetStatus, apiUploadAsset, apiUploadFile } from '../../services/uploads.ts';
import { useChannels } from '../../services/channels.ts';
import { getActiveProjectId } from '../../engine/assetPaths.ts';
import { liveFileUrl, mediaKindOf } from '../../engine/uploadRefs.ts';
import { Button } from '../ui/Button.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { inputClass, type Accent } from '../ui/accent.ts';
import type { CardViewProps } from './cardProps.ts';

const POLL_MS = 3000;
const LAST_PROVIDER_KEY = 'mw.uploadProvider';

// Every card uploads through the same platform, so a new card starts from the provider last used.
function lastProvider(): string | undefined {
  try {
    return localStorage.getItem(LAST_PROVIDER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberProvider(id: string) {
  try {
    localStorage.setItem(LAST_PROVIDER_KEY, id);
  } catch {
    // Not remembering only costs a re-pick.
  }
}

/** The name a file is stored under on the platform, keeping the saved file's extension. */
function uploadNameOf(card: SpatialCard): string {
  if (card.uploadName) return card.uploadName;
  const ext = card.resultUrl?.match(/\.[a-z0-9]+$/i)?.[0] ?? (mediaKindOf(card) === 'video' ? '.mp4' : '.png');
  return `${card.title}${ext}`;
}

type Busy = 'asset' | 'file' | null;

const ASSET_STATUS_LABEL = { Processing: '审核中', Active: '可用', Failed: '未通过' } as const;
const ASSET_STATUS_TONE = {
  Processing: 'text-amber-300 bg-amber-500/15 border-amber-500/30',
  Active: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30',
  Failed: 'text-rose-300 bg-rose-500/15 border-rose-500/30',
} as const;

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="复制"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
      className="flex-shrink-0 text-slate-500 hover:text-white"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
};

/**
 * Uploads a card's saved file (an upload card's pick or a video result) to a
 * provider's asset library or file store, and picks which copy video cards
 * send when they reference the card.
 */
export const UploadPanel: React.FC<{
  card: SpatialCard;
  onUpdateCard: CardViewProps['onUpdateCard'];
  accent?: Accent;
}> = ({ card, onUpdateCard, accent = 'amber' }) => {
  const channels = useChannels();
  const [busy, setBusy] = useState<Busy>(null);

  const providers = channels.filter((p) => p.is_configured);
  const configured = (id?: string) => (id && providers.some((p) => p.id === id) ? id : undefined);
  // Ark first: only its platform gives asset ids (Seedance).
  const provider = configured(card.uploadProvider) ?? configured(lastProvider()) ?? configured('ark') ?? providers[0]?.id;
  const fileExpired = !!card.fileUrl && !liveFileUrl(card);
  const noProvider = providers.length === 0;

  const fail = (err: unknown) => onUpdateCard(card.id, { errorMessage: (err as Error).message || '上传失败' }, { history: false });

  const uploadAsset = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !provider || !card.resultUrl) return;
    setBusy('asset');
    try {
      const res = await apiUploadAsset(provider, projectId, card.resultUrl, uploadNameOf(card));
      rememberProvider(provider);
      onUpdateCard(card.id, {
        uploadProvider: provider,
        assetId: res.asset_id,
        assetStatus: res.status,
        assetError: res.error_message,
        errorMessage: undefined,
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const uploadFile = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !provider || !card.resultUrl) return;
    setBusy('file');
    try {
      const res = await apiUploadFile(provider, projectId, card.resultUrl);
      rememberProvider(provider);
      onUpdateCard(card.id, { uploadProvider: provider, fileUrl: res.file_url, fileExpiresAt: res.expires_at, errorMessage: undefined });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  // Poll the review until the asset is usable or rejected.
  const assetProvider = card.uploadProvider;
  useEffect(() => {
    if (!card.assetId || card.assetStatus !== 'Processing' || !assetProvider) return;
    const id = card.assetId;
    const timer = setInterval(() => {
      apiAssetStatus(assetProvider, id)
        .then((res) => {
          if (res.status !== 'Processing') {
            onUpdateCard(card.id, { assetStatus: res.status, assetError: res.error_message }, { history: false });
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [card.id, card.assetId, card.assetStatus, assetProvider, onUpdateCard]);

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-canvas-bg/60 p-2">
      <label className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className="flex-shrink-0">上传到</span>
        <select
          value={provider ?? ''}
          disabled={noProvider}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            rememberProvider(e.target.value);
            onUpdateCard(card.id, { uploadProvider: e.target.value });
          }}
          className={`${inputClass} flex-1 min-w-0`}
          title="用哪个服务商的账号上传（素材库只在火山方舟可用）"
        >
          {noProvider && <option value="">还没有配置好的服务商</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          disabled={noProvider || busy !== null}
          onClick={() => void uploadAsset()}
          icon={busy === 'asset' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          title="上传到素材库，得到素材 ID（asset://…）"
        >
          {card.assetId ? '重新上传素材' : '上传素材库'}
        </Button>
        <Button
          size="sm"
          disabled={noProvider || busy !== null}
          onClick={() => void uploadFile()}
          icon={busy === 'file' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
          title="上传到文件存储，得到 7 天有效的下载链接"
        >
          {card.fileUrl ? '重新获取链接' : '获取链接'}
        </Button>
      </div>

      {card.assetId && (
        <div className="flex items-center gap-1.5 text-[11px] min-w-0">
          <span
            className={`flex-shrink-0 px-1.5 py-px rounded border ${ASSET_STATUS_TONE[card.assetStatus ?? 'Processing']}`}
            title={card.assetError}
          >
            {card.assetStatus === 'Processing' && <Loader2 className="inline w-3 h-3 mr-0.5 animate-spin" />}
            {ASSET_STATUS_LABEL[card.assetStatus ?? 'Processing']}
          </span>
          <span className="font-mono text-slate-300 truncate select-text" title={`asset://${card.assetId}`}>
            {card.assetId}
          </span>
          <CopyButton text={`asset://${card.assetId}`} />
        </div>
      )}
      {card.assetStatus === 'Failed' && card.assetError && <p className="text-[11px] text-rose-300">{card.assetError}</p>}

      {card.fileUrl && (
        <div className="flex items-center gap-1.5 text-[11px] min-w-0">
          <span className={`flex-shrink-0 px-1.5 py-px rounded border ${fileExpired ? ASSET_STATUS_TONE.Failed : ASSET_STATUS_TONE.Active}`}>
            {fileExpired ? '已过期' : '链接'}
          </span>
          <span className="font-mono text-slate-400 truncate select-text" title={card.fileUrl}>
            {card.fileUrl}
          </span>
          <CopyButton text={card.fileUrl} />
        </div>
      )}

      {(card.assetId || card.fileUrl) && (
        <div className="space-y-1 pt-1">
          <div className="text-[11px] text-slate-400">连到视频卡片时使用</div>
          <Segmented
            accent={accent}
            value={card.uploadRefMode ?? 'auto'}
            onChange={(v) => onUpdateCard(card.id, { uploadRefMode: v === 'auto' ? undefined : v })}
            options={[
              { value: 'auto', label: '自动', title: 'Seedance 用素材 ID，其余模型用链接' },
              { value: 'asset', label: '素材 ID', title: '只有 Seedance（火山方舟）能用素材 ID' },
              { value: 'url', label: '链接', title: '所有模型都能用，7 天有效' },
            ]}
          />
        </div>
      )}

      {mediaKindOf(card) === 'video' && !card.assetId && !card.fileUrl && (
        <p className="text-[11px] leading-relaxed text-slate-500">视频需要先上传（素材库或链接），才能作为参考连到视频卡片。</p>
      )}
    </div>
  );
};
