import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeVideoMeta, formatDuration, formatFps, parseMoovBytes, readMp4Timing } from './videoMeta.ts';

// Builds the boxes of a tiny MP4 so the parser is checked against real layouts.
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...payload: number[][]) => {
  const body = payload.flat();
  return [...u32(body.length + 8), ...ascii(type), ...body];
};

function trak(handler: string, timescale: number, runs: [count: number, delta: number][], mdhdVersion = 0) {
  const mdhd =
    mdhdVersion === 1
      ? box('mdhd', [1, 0, 0, 0], new Array(16).fill(0), u32(timescale), new Array(12).fill(0))
      : box('mdhd', [0, 0, 0, 0], new Array(8).fill(0), u32(timescale), u32(0), [0, 0, 0, 0]);
  const hdlr = box('hdlr', [0, 0, 0, 0], u32(0), ascii(handler), new Array(12).fill(0), [0]);
  const stts = box('stts', [0, 0, 0, 0], u32(runs.length), ...runs.flatMap(([c, d]) => [u32(c), u32(d)]));
  return box('trak', box('mdia', mdhd, hdlr, box('minf', box('stbl', stts))));
}

const ftyp = box('ftyp', ascii('isom'), u32(512), ascii('isom'));
const mdat = (n: number) => box('mdat', new Array(n).fill(7));
const moovOf = (...traks: number[][]) => box('moov', box('mvhd', new Array(100).fill(0)), ...traks);

describe('parseMoovBytes', () => {
  it('reads frames, exact length and rate from the video track', () => {
    // 24000/1001 fps: 240 frames of 1001 ticks at a timescale of 24000.
    const moov = moovOf(trak('soun', 44100, [[100, 1024]]), trak('vide', 24000, [[240, 1001]]));
    const t = parseMoovBytes(new Uint8Array(moov).buffer)!;
    expect(t.frames).toBe(240);
    expect(t.durationSec).toBeCloseTo(10.01, 6);
    expect(t.fps).toBeCloseTo(23.976, 3);
  });

  it('sums several runs of the sample table and reads a version-1 mdhd', () => {
    const moov = moovOf(trak('vide', 90000, [[60, 3000], [30, 1500]], 1));
    const t = parseMoovBytes(new Uint8Array(moov).buffer)!;
    expect(t.frames).toBe(90);
    expect(t.durationSec).toBeCloseTo(2.5, 9);
    expect(t.fps).toBeCloseTo(36, 9);
  });

  it('is undefined without a video track or with a broken table', () => {
    expect(parseMoovBytes(new Uint8Array(moovOf(trak('soun', 44100, [[10, 1024]]))).buffer)).toBeUndefined();
    const broken = moovOf(trak('vide', 25, [[0, 1]]));
    expect(parseMoovBytes(new Uint8Array(broken).buffer)).toBeUndefined();
    expect(parseMoovBytes(new Uint8Array(ftyp).buffer)).toBeUndefined();
  });
});

describe('readMp4Timing', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A fetch that serves `file` with byte ranges, counting the requests. */
  function serve(file: number[], ranges = true) {
    const bytes = new Uint8Array(file);
    const requests: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { headers: { Range: string } }) => {
        const range = init.headers.Range;
        requests.push(range);
        const [, s, e] = range.match(/bytes=(\d+)-(\d+)/)!;
        const slice = bytes.slice(Number(s), Number(e) + 1);
        return {
          status: ranges ? 206 : 200,
          body: { cancel: async () => undefined },
          arrayBuffer: async () => slice.buffer,
        };
      })
    );
    return requests;
  }

  const moov = moovOf(trak('vide', 25, [[125, 1]].map(([c]) => [c, 1] as [number, number])));

  it('finds a moov that follows a large mdat, with a few small requests', async () => {
    const requests = serve([...ftyp, ...mdat(5_000_000), ...moov]);
    const t = await readMp4Timing('/v.mp4');
    expect(t).toMatchObject({ frames: 125 });
    expect(t!.durationSec).toBeCloseTo(5, 9);
    expect(t!.fps).toBeCloseTo(25, 9);
    expect(requests.length).toBeLessThanOrEqual(4);
  });

  it('finds a moov placed before the mdat (faststart)', async () => {
    serve([...ftyp, ...moov, ...mdat(1000)]);
    expect((await readMp4Timing('/v.mp4'))?.frames).toBe(125);
  });

  it('gives up on a server without range support, or a file that is not an MP4', async () => {
    serve([...ftyp, ...moov], false);
    expect(await readMp4Timing('/v.mp4')).toBeUndefined();
    serve(ascii('RIFF....AVI LIST'));
    expect(await readMp4Timing('/v.avi')).toBeUndefined();
  });
});

describe('formatting', () => {
  it('shows rates and lengths exactly, without noise', () => {
    expect(formatFps(24)).toBe('24');
    expect(formatFps(23.976023976)).toBe('23.976');
    expect(formatFps(29.97003)).toBe('29.97');
    expect(formatDuration(5.04)).toBe('5.04s');
    expect(formatDuration(10.01)).toBe('10.01s');
    expect(formatDuration(65.5)).toBe('1:05.50');
  });

  it('describes what is known and leaves out what is not', () => {
    expect(describeVideoMeta({ width: 1920, height: 1080, durationSec: 5.04, fps: 24 })).toBe('1920×1080 · 24 fps · 5.04s');
    expect(describeVideoMeta({ width: 1280, height: 720, durationSec: 3.5 })).toBe('1280×720 · 3.50s');
  });
});
