import React, { useEffect } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import { IconButton } from './ui/index.ts';

export interface ViewerMedia {
  url: string;
  kind: 'image' | 'video';
  title: string;
}

/** Full-screen view of a generated image or video, with download and open-in-tab. */
export const MediaViewer: React.FC<{ media: ViewerMedia; onClose: () => void }> = ({ media, onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const fileName = media.url.split('/').pop()?.split('?')[0] || (media.kind === 'video' ? 'video.mp4' : 'image.png');

  return (
    <div className="fixed inset-0 z-[65] flex flex-col bg-black/90 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex items-center gap-2 px-4 h-14 flex-shrink-0 text-slate-200">
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{media.title}</span>
        <a
          href={media.url}
          download={`${media.title}-${fileName}`}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold"
        >
          <Download className="w-3.5 h-3.5" /> 下载
        </a>
        <a
          href={media.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg hover:bg-slate-800 text-xs font-semibold"
        >
          <ExternalLink className="w-3.5 h-3.5" /> 新窗口打开
        </a>
        <IconButton title="关闭（Esc）" onClick={onClose}>
          <X className="w-5 h-5" />
        </IconButton>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center p-6 pt-0" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {media.kind === 'image' ? (
          <img src={media.url} alt={media.title} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
        ) : (
          <video src={media.url} controls autoPlay loop className="max-w-full max-h-full rounded-lg shadow-2xl" />
        )}
      </div>
    </div>
  );
};
