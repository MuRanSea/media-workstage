import React, { useEffect, useState } from 'react';
import { describeVideoMeta, readMp4Timing, type VideoMeta } from '../../engine/videoMeta.ts';

const cache = new Map<string, Promise<VideoMeta | undefined>>();

/** Pixel size from the browser (it knows rotation), rate and length from the file's header. */
function loadMeta(url: string): Promise<VideoMeta | undefined> {
  let pending = cache.get(url);
  if (!pending) {
    pending = (async () => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.muted = true;
      const dims = new Promise<{ width: number; height: number; duration: number } | undefined>((resolve) => {
        el.onloadedmetadata = () => resolve({ width: el.videoWidth, height: el.videoHeight, duration: el.duration });
        el.onerror = () => resolve(undefined);
      });
      el.src = url;
      const [size, timing] = await Promise.all([dims, readMp4Timing(url).catch(() => undefined)]);
      el.removeAttribute('src');
      el.load();
      if (!size) return undefined;
      return {
        width: size.width,
        height: size.height,
        durationSec: timing?.durationSec ?? (Number.isFinite(size.duration) ? size.duration : 0),
        fps: timing?.fps,
        frames: timing?.frames,
      };
    })();
    cache.set(url, pending);
    // A failed read is tried again next time the card shows, not remembered.
    void pending.then((meta) => {
      if (!meta) cache.delete(url);
    });
  }
  return pending;
}

/** "1920×1080 · 24 fps · 5.04s" for a video card's file; nothing until it has been read. */
export const VideoMetaLine: React.FC<{ url: string | undefined }> = ({ url }) => {
  const [meta, setMeta] = useState<VideoMeta>();

  useEffect(() => {
    setMeta(undefined);
    if (!url) return;
    let live = true;
    void loadMeta(url).then((m) => live && setMeta(m));
    return () => {
      live = false;
    };
  }, [url]);

  const text = meta && describeVideoMeta(meta);
  if (!text) return null;
  return (
    <div
      className="truncate font-mono text-[11px] text-slate-500"
      title={meta.frames ? `${text} · 共 ${meta.frames} 帧` : text}
    >
      {text}
    </div>
  );
};
