/**
 * What a video file says about itself, read straight from its MP4/MOV header so the numbers are
 * exact: a browser's `video.duration` is rounded to what it decoded, and it never reports a
 * frame rate. The container knows both: the video track's sample table (`stts`) gives the
 * frame count and the length down to the timescale tick.
 */

export interface Mp4Timing {
  /** Video track length in seconds, to the media timescale's resolution. */
  durationSec: number;
  frames: number;
  /** Frames ÷ seconds: the average rate, so a variable-rate file reads as its mean. */
  fps: number;
}

interface Box {
  type: string;
  /** Offset of the box payload (after the 8- or 16-byte header). */
  start: number;
  end: number;
}

const HEADER_PEEK = 16;

/** The box at `offset` in `view`, or undefined when its header does not fit or its size is invalid. */
function boxAt(view: DataView, offset: number, limit = view.byteLength): Box | undefined {
  if (offset + 8 > limit) return undefined;
  let size = view.getUint32(offset);
  const type = String.fromCharCode(...[4, 5, 6, 7].map((i) => view.getUint8(offset + i)));
  let header = 8;
  if (size === 1) {
    if (offset + HEADER_PEEK > limit) return undefined;
    size = Number(view.getBigUint64(offset + 8));
    header = HEADER_PEEK;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < header || offset + size > limit) return undefined;
  return { type, start: offset + header, end: offset + size };
}

function* children(view: DataView, parent: { start: number; end: number }): Generator<Box> {
  let offset = parent.start;
  while (offset < parent.end) {
    const box = boxAt(view, offset, parent.end);
    if (!box) return;
    yield box;
    offset = box.end;
  }
}

function child(view: DataView, parent: { start: number; end: number }, type: string): Box | undefined {
  for (const box of children(view, parent)) if (box.type === type) return box;
  return undefined;
}

/** The handler type ('vide', 'soun'…) a `trak` declares in `mdia/hdlr`. */
function handlerOf(view: DataView, mdia: Box): string {
  const hdlr = child(view, mdia, 'hdlr');
  if (!hdlr || hdlr.start + 12 > hdlr.end) return '';
  return String.fromCharCode(...[8, 9, 10, 11].map((i) => view.getUint8(hdlr.start + i)));
}

/** Timing of the first video track in a `moov` box held in `view`; undefined when it has none or is malformed. */
export function parseMoov(view: DataView, moov: { start: number; end: number }): Mp4Timing | undefined {
  for (const trak of children(view, moov)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(view, trak, 'mdia');
    if (!mdia || handlerOf(view, mdia) !== 'vide') continue;

    const mdhd = child(view, mdia, 'mdhd');
    const stts = child(view, child(view, child(view, mdia, 'minf') ?? mdia, 'stbl') ?? mdia, 'stts');
    if (!mdhd || !stts || stts.start + 8 > stts.end) return undefined;

    const version = view.getUint8(mdhd.start);
    const timescale = view.getUint32(mdhd.start + (version === 1 ? 20 : 12));
    if (!timescale) return undefined;

    const entries = view.getUint32(stts.start + 4);
    if (stts.start + 8 + entries * 8 > stts.end) return undefined;
    let frames = 0;
    let ticks = 0;
    for (let i = 0; i < entries; i++) {
      const count = view.getUint32(stts.start + 8 + i * 8);
      frames += count;
      ticks += count * view.getUint32(stts.start + 12 + i * 8);
    }
    if (frames === 0 || ticks === 0) return undefined;
    const durationSec = ticks / timescale;
    return { durationSec, frames, fps: frames / durationSec };
  }
  return undefined;
}

/** The timing in a whole `moov` payload fetched on its own (a box header followed by its children). */
export function parseMoovBytes(bytes: ArrayBuffer): Mp4Timing | undefined {
  const view = new DataView(bytes);
  const moov = boxAt(view, 0);
  return moov?.type === 'moov' ? parseMoov(view, moov) : undefined;
}

/** Largest `moov` we will download to read; a header that big is not worth it. */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
/** Top-level boxes to step through before giving up (ftyp, free, mdat, moov… is a handful). */
const MAX_STEPS = 24;

async function readRange(url: string, start: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer | undefined> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal });
  // A server that ignores Range would send the whole file; never read that for a few bytes.
  if (res.status !== 206) {
    void res.body?.cancel();
    return undefined;
  }
  return res.arrayBuffer();
}

/**
 * Reads a video's frame count, rate and exact length from its MP4/MOV header by range
 * requests, walking the top-level boxes to `moov` (often after a large `mdat`). Undefined
 * when the file is not an MP4/MOV, the server cannot do ranges, or the header is unreadable.
 */
export async function readMp4Timing(url: string, signal?: AbortSignal): Promise<Mp4Timing | undefined> {
  let offset = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const head = await readRange(url, offset, HEADER_PEEK, signal);
    if (!head || head.byteLength < 8) return undefined;
    const view = new DataView(head);
    let size = view.getUint32(0);
    const type = String.fromCharCode(...[4, 5, 6, 7].map((i) => view.getUint8(i)));
    if (step === 0 && type !== 'ftyp') return undefined;
    if (size === 1 && head.byteLength >= HEADER_PEEK) size = Number(view.getBigUint64(8));
    if (size < 8) return undefined; // 0 means "to the end of the file": nothing after it to read

    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) return undefined;
      const moov = await readRange(url, offset, size, signal);
      return moov ? parseMoovBytes(moov) : undefined;
    }
    offset += size;
  }
  return undefined;
}

/** "23.976", "24", "29.97": up to three decimals, no trailing zeros. */
export function formatFps(fps: number): string {
  return String(Number(fps.toFixed(3)));
}

/** Seconds to the hundredth ("5.04s"); a minute or more reads "1:05.04". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

export interface VideoMeta {
  width: number;
  height: number;
  durationSec: number;
  /** Absent when the file is not a readable MP4/MOV. */
  fps?: number;
  frames?: number;
}

/** "1920×1080 · 24 fps · 5.04s", with what the file could not tell left out. */
export function describeVideoMeta(meta: VideoMeta): string {
  return [
    meta.width && meta.height ? `${meta.width}×${meta.height}` : '',
    meta.fps ? `${formatFps(meta.fps)} fps` : '',
    meta.durationSec > 0 ? formatDuration(meta.durationSec) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
