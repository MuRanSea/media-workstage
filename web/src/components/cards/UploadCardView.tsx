import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Film, Image as ImageIcon, Link2, Loader2, Maximize2, RefreshCw, Upload } from 'lucide-react';
import { apiAssetStatus, apiUploadAsset, apiUploadFile, apiUploadLocal } from '../../services/uploads.ts';
import { useChannels } from '../../services/channels.ts';
import { assetUrl, getActiveProjectId } from '../../engine/assetPaths.ts';
import { liveFileUrl } from '../../engine/uploadRefs.ts';
import { cardTag } from '../../engine/refTags.ts';
import { Button } from '../ui/Button.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { inputClass } from '../ui/accent.ts';
import { OutputPort } from './CardPorts.tsx';
import { CardShell, ErrorBox, MediaFrame } from './CardShell.tsx';
import type { CardViewProps } from './cardProps.ts';

const ACCEPT = { image: 'image/png,image/jpeg,image/webp', video: 'video/mp4,video/quicktime,.mp4,.mov' } as const;
const MAX_MB = { image: 10, video: 200 } as const;
const POLL_MS = 3000;

interface UploadCardViewProps extends CardViewProps {
  onStartConnect?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

type Busy = 'local' | 'asset' | 'file' | null;

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

/** Card holding a picked image or video that can be uploaded to a provider and wired into a video card. */
export const UploadCardView: React.FC<UploadCardViewProps> = ({
  card,
  isSelected,
  connectHint,
  onSelect,
  onStartDrag,
  onUpdateCard,
  menuItems,
  onOpenViewer,
  onStartConnect,
}) => {
  const kind = card.mediaKind ?? 'image';
  const channels = useChannels();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loadedAspect, setLoadedAspect] = useState<number>();

  const providers = channels.filter((p) => p.is_configured);
  const provider = card.uploadProvider && providers.some((p) => p.id === card.uploadProvider) ? card.uploadProvider : providers[0]?.id;
  const previewUrl = assetUrl(card.resultUrl);
  const fileExpired = !!card.fileUrl && !liveFileUrl(card);
  const Icon = kind === 'video' ? Film : ImageIcon;
  const noun = kind === 'video' ? '视频' : '图片';

  const fail = (err: unknown) => onUpdateCard(card.id, { errorMessage: (err as Error).message || '上传失败' }, { history: false });

  const pick = async (file: File | undefined) => {
    const projectId = getActiveProjectId();
    if (!file || !projectId) return;
    if (file.size > MAX_MB[kind] * 1024 * 1024) return fail(new Error(`${noun}不能超过 ${MAX_MB[kind]} MiB`));
    setBusy('local');
    try {
      const saved = await apiUploadLocal(projectId, kind, file);
      // A new file invalidates whatever was uploaded for the old one.
      onUpdateCard(card.id, {
        resultUrl: saved.local_path,
        uploadName: saved.name,
        status: 'succeeded',
        errorMessage: undefined,
        assetId: undefined,
        assetStatus: undefined,
        assetError: undefined,
        fileUrl: undefined,
        fileExpiresAt: undefined,
        uploadRefMode: undefined,
      });
      setLoadedAspect(undefined);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  };

  const uploadAsset = async () => {
    const projectId = getActiveProjectId();
    if (!projectId || !provider || !card.resultUrl) return;
    setBusy('asset');
    try {
      const res = await apiUploadAsset(provider, projectId, card.resultUrl, card.uploadName);
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

  const sizeHint = `${kind === 'video' ? 'mp4 / mov' : 'png / jpg / webp'} · ≤ ${MAX_MB[kind]} MiB`;
  const noProvider = providers.length === 0;

  return (
    <CardShell
      card={card}
      accent="amber"
      icon={<Icon className="w-4 h-4" />}
      isSelected={isSelected}
      connectHint={connectHint}
      onSelect={onSelect}
      onStartDrag={onStartDrag}
      onRename={(title) => onUpdateCard(card.id, { title })}
      badges={
        <span
          title={`在视频提示词里用 ${cardTag(card)} 引用`}
          className="flex-shrink-0 font-mono text-[11px] px-1.5 py-px rounded-md border bg-amber-500/15 text-amber-300 border-amber-500/30"
        >
          {cardTag(card)}
        </span>
      }
      menuItems={menuItems}
      ports={onStartConnect && <OutputPort color="amber" onStart={onStartConnect} />}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT[kind]}
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      <MediaFrame aspect={(previewUrl && loadedAspect) || 16 / 9}>
        {previewUrl ? (
          kind === 'video' ? (
            <>
              <video
                src={previewUrl}
                muted
                playsInline
                controls
                preload="metadata"
                className="w-full h-full object-contain"
                onLoadedMetadata={(e) => setLoadedAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)}
              />
              <button
                type="button"
                title="放大播放"
                onClick={() => onOpenViewer({ url: previewUrl, kind: 'video', title: card.title })}
                className="absolute top-2 left-2 p-1 rounded-md bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              title="查看大图"
              onClick={() => onOpenViewer({ url: previewUrl, kind: 'image', title: card.title })}
              className="block w-full h-full cursor-zoom-in"
            >
              <img
                src={previewUrl}
                alt={card.title}
                className="w-full h-full object-contain"
                onLoad={(e) => setLoadedAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
              />
            </button>
          )
        ) : (
          <button
            type="button"
            disabled={busy === 'local'}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void pick(e.dataTransfer.files?.[0]);
            }}
            className={`w-full h-full flex flex-col items-center justify-center gap-1 text-center transition ${
              dragOver ? 'bg-amber-500/15' : 'bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-950 hover:from-amber-950/50'
            }`}
          >
            {busy === 'local' ? <Loader2 className="w-6 h-6 text-amber-300 animate-spin" /> : <Upload className="w-6 h-6 text-amber-400/70" />}
            <span className="text-xs text-slate-300">点击或拖入{noun}</span>
            <span className="text-[11px] text-slate-500">{sizeHint}</span>
          </button>
        )}
      </MediaFrame>

      {card.resultUrl && (
        <>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 min-w-0">
            <span className="truncate flex-1" title={card.uploadName}>
              {card.uploadName ?? noun}
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-0.5 text-slate-400 hover:text-white flex-shrink-0 disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" /> 更换
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-800 bg-canvas-bg/60 p-2">
            <select
              value={provider ?? ''}
              disabled={noProvider}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => onUpdateCard(card.id, { uploadProvider: e.target.value })}
              className={inputClass}
              title="上传到哪个服务商"
            >
              {noProvider && <option value="">还没有配置好的服务商</option>}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

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
                <span
                  className={`flex-shrink-0 px-1.5 py-px rounded border ${
                    fileExpired ? ASSET_STATUS_TONE.Failed : ASSET_STATUS_TONE.Active
                  }`}
                >
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
                  accent="amber"
                  value={card.uploadRefMode ?? 'auto'}
                  onChange={(v) => onUpdateCard(card.id, { uploadRefMode: v === 'auto' ? undefined : v })}
                  options={[
                    { value: 'auto', label: '自动', title: 'Seedance 用素材 ID，其余模型用链接' },
                    { value: 'asset', label: '素材 ID', title: '只有 Seedance（火山方舟）能用素材 ID' },
                    { value: 'url', label: '链接', title: '所有模型都能用，7 天有效' },
                  ]}
                />
                <p className="text-[11px] leading-relaxed text-slate-500">
                  {card.uploadRefMode === 'asset'
                    ? '仅 Seedance 可用；连到其他模型会提示改选链接。'
                    : card.uploadRefMode === 'url'
                    ? '所有模型可用，链接 7 天内有效。'
                    : 'Seedance 用素材 ID（审核通过后），其余模型用链接。'}
                </p>
              </div>
            )}

            {kind === 'video' && !card.assetId && !card.fileUrl && (
              <p className="text-[11px] leading-relaxed text-slate-500">视频需要先上传（素材库或链接），才能作为参考连到视频卡片。</p>
            )}
          </div>
        </>
      )}

      {card.errorMessage && <ErrorBox message={card.errorMessage} />}
    </CardShell>
  );
};
