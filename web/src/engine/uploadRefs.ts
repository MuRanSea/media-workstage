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

/**
 * What a video card sends for an upload card: the asset id where the protocol speaks
 * asset:// (Ark), else the download URL, else (images only) the saved file itself.
 */
export function uploadReference(card: SpatialCard, protocol: Protocol): { url?: string; localPath?: string } {
  const asset = protocol === 'ark' ? assetUri(card) : undefined;
  const url = asset ?? liveFileUrl(card) ?? assetUri(card);
  if (url) return { url };
  if (!card.resultUrl) throw new Error(`上传卡片「${card.title}」还没有选择${card.mediaKind === 'video' ? '视频' : '图片'}`);
  if (card.mediaKind === 'video') {
    if (card.assetId && card.assetStatus === 'Processing') {
      throw new Error(`上传卡片「${card.title}」的素材还在审核中，请稍后再试`);
    }
    if (card.assetStatus === 'Failed') {
      throw new Error(`上传卡片「${card.title}」的素材审核未通过：${card.assetError ?? '未知原因'}`);
    }
    throw new Error(`视频不能内联发送：请先在上传卡片「${card.title}」上传到素材库或获取链接`);
  }
  return { localPath: card.resultUrl };
}
