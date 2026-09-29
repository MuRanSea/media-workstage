import type { Protocol } from '../services/api.ts';
import type { SpatialCard } from '../types/canvas.ts';

const nowSeconds = () => Date.now() / 1000;

/** An asset reference (asset://<id>) is only usable once the platform approved it. */
export function assetUri(card: SpatialCard): string | undefined {
  return card.assetId && card.assetStatus === 'Active' ? `asset://${card.assetId}` : undefined;
}

/** The uploaded download URL while it has not expired. */
export function liveFileUrl(card: SpatialCard): string | undefined {
  return card.fileUrl && (!card.fileExpiresAt || card.fileExpiresAt > nowSeconds() + 60) ? card.fileUrl : undefined;
}

/** Only Ark (Seedance) understands asset://; every other protocol needs a download URL. */
export function supportsAssetId(protocol: Protocol): boolean {
  return protocol === 'ark';
}

function assetProblem(card: SpatialCard): string {
  if (!card.assetId) return `上传卡片「${card.title}」选了「素材 ID」，但还没有上传到素材库`;
  if (card.assetStatus === 'Failed') return `上传卡片「${card.title}」的素材审核未通过：${card.assetError ?? '未知原因'}`;
  return `上传卡片「${card.title}」的素材还在审核中，请稍后再试`;
}

function urlProblem(card: SpatialCard): string {
  return card.fileUrl
    ? `上传卡片「${card.title}」的链接已过期，请重新获取链接`
    : `上传卡片「${card.title}」选了「链接」，但还没有获取链接`;
}

/**
 * What a video card sends for an upload card. The card's own choice wins
 * (uploadRefMode); with none, Ark gets the asset id once approved, everything else the
 * download URL, and an image that was never uploaded falls back to the saved file.
 * Throws a message telling the user what to do when the choice cannot be honoured.
 */
export function uploadReference(card: SpatialCard, protocol: Protocol): { url?: string; localPath?: string } {
  const choice = card.uploadRefMode;

  if (choice === 'asset') {
    if (!supportsAssetId(protocol)) {
      throw new Error(`上传卡片「${card.title}」选了「素材 ID」，但该模型只支持链接（素材 ID 仅 Seedance 可用），请改选「链接」`);
    }
    const uri = assetUri(card);
    if (!uri) throw new Error(assetProblem(card));
    return { url: uri };
  }
  if (choice === 'url') {
    const url = liveFileUrl(card);
    if (!url) throw new Error(urlProblem(card));
    return { url };
  }

  const url = (supportsAssetId(protocol) ? assetUri(card) : undefined) ?? liveFileUrl(card);
  if (url) return { url };
  if (!card.resultUrl) throw new Error(`上传卡片「${card.title}」还没有选择${card.mediaKind === 'video' ? '视频' : '图片'}`);
  if (card.mediaKind === 'video') {
    if (supportsAssetId(protocol) && card.assetId && card.assetStatus !== 'Active') throw new Error(assetProblem(card));
    throw new Error(
      supportsAssetId(protocol)
        ? `视频不能内联发送：请先在上传卡片「${card.title}」上传到素材库或获取链接`
        : `该模型需要视频的公网链接：请先在上传卡片「${card.title}」点「获取链接」`
    );
  }
  return { localPath: card.resultUrl };
}

export type UploadRefKind = 'asset' | 'url' | 'local';

/** Which of the card's copies a video card on `protocol` would send, or undefined when none is usable yet. */
export function uploadRefKind(card: SpatialCard, protocol: Protocol): UploadRefKind | undefined {
  try {
    const ref = uploadReference(card, protocol);
    if (ref.localPath) return 'local';
    return ref.url?.startsWith('asset://') ? 'asset' : 'url';
  } catch {
    return undefined;
  }
}

export const UPLOAD_REF_LABELS: Record<UploadRefKind, string> = { asset: '素材 ID', url: '链接', local: '本地文件' };
