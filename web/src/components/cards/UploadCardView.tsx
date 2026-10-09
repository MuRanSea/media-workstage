import React, { useRef, useState } from 'react';
import { Film, Image as ImageIcon, Loader2, Maximize2, RefreshCw, Upload } from 'lucide-react';
import { apiUploadLocal } from '../../services/uploads.ts';
import { assetUrl, getActiveProjectId } from '../../engine/assetPaths.ts';
import { cardTag } from '../../engine/refTags.ts';
import { OutputPort } from './CardPorts.tsx';
import { CardShell, ErrorBox, MediaFrame } from './CardShell.tsx';
import { UploadPanel } from './UploadPanel.tsx';
import type { CardViewProps } from './cardProps.ts';

const ACCEPT = { image: 'image/png,image/jpeg,image/webp', video: 'video/mp4,video/quicktime,.mp4,.mov' } as const;
const MAX_MB = { image: 10, video: 200 } as const;
interface UploadCardViewProps extends CardViewProps {
  onStartConnect?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loadedAspect, setLoadedAspect] = useState<number>();

  const previewUrl = assetUrl(card.resultUrl);
  const Icon = kind === 'video' ? Film : ImageIcon;
  const noun = kind === 'video' ? '视频' : '图片';

  const fail = (err: unknown) => onUpdateCard(card.id, { errorMessage: (err as Error).message || '上传失败' }, { history: false });

  const pick = async (file: File | undefined) => {
    const projectId = getActiveProjectId();
    if (!file || !projectId) return;
    if (file.size > MAX_MB[kind] * 1024 * 1024) return fail(new Error(`${noun}不能超过 ${MAX_MB[kind]} MiB`));
    setBusy(true);
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
      setBusy(false);
    }
  };

  const sizeHint = `${kind === 'video' ? 'mp4 / mov' : 'png / jpg / webp'} · ≤ ${MAX_MB[kind]} MiB`;

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
                decoding="async"
                className="w-full h-full object-contain"
                onLoad={(e) => setLoadedAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
              />
            </button>
          )
        ) : (
          <button
            type="button"
            disabled={busy}
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
            {busy ? <Loader2 className="w-6 h-6 text-amber-300 animate-spin" /> : <Upload className="w-6 h-6 text-amber-400/70" />}
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
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="flex items-center gap-0.5 text-slate-400 hover:text-slate-50 flex-shrink-0 disabled:opacity-40"
            >
              <RefreshCw className="w-3 h-3" /> 更换
            </button>
          </div>

          <UploadPanel card={card} onUpdateCard={onUpdateCard} />
        </>
      )}

      {card.errorMessage && <ErrorBox message={card.errorMessage} />}
    </CardShell>
  );
};
