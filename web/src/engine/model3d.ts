import type { CapabilityDescriptor } from '../services/api.ts';
import type { ReferenceItem, SpatialCard, TaskAssetDto } from '../types/canvas.ts';
import type { ModelOption } from './channelModels.ts';
import { capValuesPatch, cardCapability, effectiveParams } from './capability.ts';
import { assetStoredPath } from './assetPaths.ts';

/**
 * 3D cards run only on Heighliner (CONTEXT.md: 3D Generation Card). Each connected image
 * shows one view of the object and goes as that view's gateway role; which views a model
 * takes comes from its descriptor; the documented combination rules are heighlinerRules'.
 */

/** Shown wherever a 3D card has no model to run on. */
export const NO_3D_MODELS_HINT = '需要先添加 Heighliner 服务商并获取模型列表';

/** Gateway roles of the views, in the order they are offered, with their Chinese names. */
export const VIEW_LABELS: Record<string, string> = {
  reference: '主图',
  multi_view_front: '正面',
  multi_view_left: '左',
  multi_view_right: '右',
  multi_view_back: '背',
  multi_view_top: '顶',
  multi_view_bottom: '底',
  multi_view_left_front: '左前',
  multi_view_right_front: '右前',
};
const VIEW_ORDER = Object.keys(VIEW_LABELS);

/**
 * 主图 and 正面 are one slot on every 3D model: Hunyuan takes one main image as either, and
 * Tripo's multi-view sends the main image as the front. Holding one leaves the other unoffered.
 */
const TWIN_VIEWS: Record<string, string> = { reference: 'multi_view_front', multi_view_front: 'reference' };
const withTwins = (views: Iterable<string>) => new Set([...views].flatMap((v) => (TWIN_VIEWS[v] ? [v, TWIN_VIEWS[v]] : [v])));

/** A reference's view; references saved without one are the main image. */
export const viewOf = (ref: Pick<ReferenceItem, 'view'>): string => ref.view ?? 'reference';

export function viewLabel(view: string): string {
  return VIEW_LABELS[view] ?? view;
}

/** Views the model takes an image for: the known ones in display order, then any new role it declares. */
export function capViews(cap: CapabilityDescriptor | undefined): string[] {
  const roles = [...new Set((cap?.references ?? []).filter((r) => (r.types ?? []).includes('image')).map((r) => r.role))];
  return [...VIEW_ORDER.filter((v) => roles.includes(v)), ...roles.filter((r) => !VIEW_ORDER.includes(r))];
}

/**
 * References fitted to `views`: each keeps its view while the model takes it and no earlier
 * reference holds it; the others take the free views in order (主图 first). References left
 * without a view are dropped.
 */
export function fitViews(refs: ReferenceItem[], views: string[]): ReferenceItem[] {
  const taken = new Set<string>();
  const keeps = refs.map((r) => {
    const keep = views.includes(viewOf(r)) && !taken.has(viewOf(r));
    if (keep) taken.add(viewOf(r));
    return keep;
  });
  const out: ReferenceItem[] = [];
  refs.forEach((r, i) => {
    if (keeps[i]) return out.push({ ...r, view: viewOf(r) });
    const free = views.find((v) => !withTwins(taken).has(v));
    if (!free) return;
    taken.add(free);
    out.push({ ...r, view: free });
  });
  return out;
}

/**
 * The view a newly connected image takes: the first one free (正面 is not free beside a 主图).
 * Without a descriptor (no model yet) only the main image is offered, so the card still shows
 * what it was given.
 */
export function nextView(card: SpatialCard): { view?: string; views: string[] } {
  const cap = cardCapability(card);
  const views = cap ? capViews(cap) : ['reference'];
  const used = withTwins((card.references ?? []).map(viewOf));
  return { view: views.find((v) => !used.has(v)), views };
}

/** Puts reference `cardId` on `view`; a reference already there takes its old view. */
export function setViewPatch(card: SpatialCard, cardId: string, view: string): Partial<SpatialCard> {
  const refs = card.references ?? [];
  const moved = refs.find((r) => r.cardId === cardId);
  if (!moved) return {};
  const old = viewOf(moved);
  return {
    references: refs.map((r) => (r.cardId === cardId ? { ...r, view } : viewOf(r) === view ? { ...r, view: old } : r)),
  };
}

/** Switching a 3D card's model: values refit to the new descriptor, views to the views it takes. */
export function model3DPatch(card: SpatialCard, option: Pick<ModelOption, 'provider' | 'id'>): Partial<SpatialCard> {
  const next = { provider: option.provider, model: option.id };
  const cap = cardCapability(next);
  return {
    ...next,
    ...capValuesPatch(cap, card),
    // Without a descriptor nothing is known to refit to; the card says so until models are fetched.
    ...(cap ? { references: fitViews(card.references ?? [], capViews(cap)) } : {}),
  };
}

/** e.g. "FBX · 2 张参考图"; "文生 3D" without references. */
export function spec3DSummary(card: SpatialCard): string {
  const format = effectiveParams(cardCapability(card), card.capParams).output_format;
  const refs = card.references?.length ?? 0;
  return [typeof format === 'string' ? format.toUpperCase() : '', refs ? `${refs} 张参考图` : '文生 3D'].filter(Boolean).join(' · ');
}

// --- Result files ----------------------------------------------------------------

/** The model files of a 3D result, one per format, with the format's name. */
export function modelFiles(card: Pick<SpatialCard, 'outputAssets'>): { format: string; asset: TaskAssetDto }[] {
  return (card.outputAssets ?? [])
    .filter((a) => a.kind === 'model3d' || a.kind === 'video')
    .map((asset) => ({ format: formatOf(asset), asset }));
}

/** "GLB", "FBX", "MP4" … from the file's extension. */
export function formatOf(asset: TaskAssetDto): string {
  const ext = (asset.local_path || asset.remote_url || '').match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1];
  return (ext ?? asset.name ?? asset.kind).toUpperCase();
}

/** Where a 3D result's face comes from: the cover image, if the run returned one. */
export function coverPath(assets: TaskAssetDto[] | undefined): string | undefined {
  return assetStoredPath(assets?.find((a) => a.kind === 'cover'));
}

/**
 * Formats the 3D preview can open. BIN is a file the gateway did not name; results from
 * before the download sniffed those are GLBs, which the loader knows by their bytes.
 */
const PREVIEW_FORMATS = ['GLB', 'GLTF', 'BIN'];

/** The file the 3D preview opens: a GLB, else a glTF, else an unnamed file; none otherwise. */
export function previewFile(card: Pick<SpatialCard, 'outputAssets'>): TaskAssetDto | undefined {
  const files = modelFiles(card).filter((f) => f.asset.kind === 'model3d');
  for (const format of PREVIEW_FORMATS) {
    const hit = files.find((f) => f.format === format);
    if (hit) return hit.asset;
  }
  return undefined;
}
