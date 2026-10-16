import type { CapabilityDescriptor, CapabilityParam, ProviderId } from '../services/api.ts';
import type { AssetKind, CapOptions, CapValue, CapValues, SpatialCard, VideoModelDef, VideoTaskMode } from '../types/canvas.ts';
import { capabilityOf, protocolOf } from './providers.ts';

/**
 * Heighliner cards are configured from the bound model's capability descriptor (ADR 0010):
 * it says which parameters, vendor options and reference roles the model takes. These
 * rules turn a card's values into what the gateway receives, and keep them inside what
 * the current model declares.
 */

export function isHeighliner(provider: ProviderId | undefined): boolean {
  return protocolOf(provider) === 'heighliner';
}

/** The descriptor of a Heighliner card's model; undefined for other providers or an unlisted model. */
export function cardCapability(card: Pick<SpatialCard, 'provider' | 'model'>): CapabilityDescriptor | undefined {
  return isHeighliner(card.provider) ? capabilityOf(card.provider, card.model) : undefined;
}

/** Thrown when a Heighliner card's model has no descriptor, so nothing can be compiled for it. */
export function requireCapability(card: Pick<SpatialCard, 'provider' | 'model'>): CapabilityDescriptor {
  const cap = cardCapability(card);
  if (!cap) throw new Error(`模型 ${card.model} 没有能力描述，请在设置里重新获取这个服务商的模型列表`);
  return cap;
}

// --- Parameters ------------------------------------------------------------------

/** Common parameters the 规格 page shows, in display order. `size` and `prompt` are never shown. */
export const SPEC_PARAMS = [
  'aspect_ratio',
  'resolution',
  'duration',
  'n',
  'generate_audio',
  'seed',
  'negative_prompt',
  'output_format',
] as const;

export const SPEC_LABELS: Record<string, string> = {
  aspect_ratio: '比例',
  resolution: '清晰度',
  duration: '时长',
  n: '张数',
  generate_audio: '生成音频',
  seed: '随机种子',
  negative_prompt: '反向提示词',
  output_format: '文件格式',
};

export interface CapField {
  name: string;
  param: CapabilityParam;
}

const SCALAR_TYPES: ReadonlySet<string> = new Set(['string', 'integer', 'number', 'boolean']);

/** The common parameters this model declares, in display order. */
export function specFields(cap: CapabilityDescriptor | undefined): CapField[] {
  const params = cap?.parameters ?? {};
  return SPEC_PARAMS.filter((name) => params[name] && SCALAR_TYPES.has(params[name].type)).map((name) => ({
    name,
    param: params[name],
  }));
}

/**
 * Vendor options a card sets through a control of its own, never as a generic field: the
 * Seedance 2.5 sample switch and the sample a final video is made from, and Kling's
 * multi_shot, which must be true exactly when Omni has a reference video.
 */
const MANAGED_OPTIONS: ReadonlySet<string> = new Set(['volcengine.draft', 'volcengine.draft_task_id', 'kling.multi_shot']);

/** Vendor options by namespace (`provider_options.<ns>`), scalar fields only. */
export function optionGroups(cap: CapabilityDescriptor | undefined): { ns: string; fields: CapField[] }[] {
  const namespaces = cap?.provider_options_schema?.properties ?? {};
  return Object.entries(namespaces)
    .map(([ns, schema]) => ({
      ns,
      fields: Object.entries(schema.properties ?? {})
        .filter(([name, param]) => SCALAR_TYPES.has(param.type) && !MANAGED_OPTIONS.has(`${ns}.${name}`))
        .map(([name, param]) => ({ name, param })),
    }))
    .filter((g) => g.fields.length > 0);
}

// --- Seedance 2.5 samples (样片) --------------------------------------------------

/** A sample is 480p, and the full video made from it is 1080p; the gateway wants both explicit. */
export const SAMPLE_RESOLUTION = '480p';
export const FINAL_RESOLUTION = '1080p';

/**
 * Whether a Heighliner video card can render a sample: only Seedance 2.5 can. The gateway's
 * catalog does not list `draft` among the vendor options, so the model decides.
 */
export function supportsSample(card: Pick<SpatialCard, 'provider' | 'model' | 'type'>): boolean {
  return card.type === 'video' && isHeighliner(card.provider) && /seedance-2[-.]5/.test(card.model);
}

/** Whether the card is set to render a sample (and could). */
export function isSampleRun(card: Pick<SpatialCard, 'provider' | 'model' | 'type' | 'sampleMode'>): boolean {
  return !!card.sampleMode && supportsSample(card);
}

/** The common parameters a card sends: its own, fitted to the model, with a sample's resolution fixed. */
export function sentParams(cap: CapabilityDescriptor | undefined, card: Pick<SpatialCard, 'provider' | 'model' | 'type' | 'sampleMode' | 'capParams'>): CapValues {
  const params = effectiveParams(cap, card.capParams);
  return isSampleRun(card) && cap?.parameters?.resolution ? { ...params, resolution: SAMPLE_RESOLUTION } : params;
}

/** The vendor options a card sends: its own, fitted to the model, plus the sample switch. */
export function sentOptions(cap: CapabilityDescriptor | undefined, card: Pick<SpatialCard, 'provider' | 'model' | 'type' | 'sampleMode' | 'capOptions'>): CapOptions {
  const options = effectiveOptions(cap, card.capOptions);
  return isSampleRun(card) ? { ...options, volcengine: { ...options.volcengine, draft: true } } : options;
}

/** Whether `value` is something `param` accepts: right type, in its enum, inside its range and length. */
export function fitsParam(param: CapabilityParam, value: unknown): value is CapValue {
  switch (param.type) {
    case 'boolean':
      if (typeof value !== 'boolean') return false;
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return false;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      break;
    case 'string':
      if (typeof value !== 'string') return false;
      if (param.minLength !== undefined && value.length < param.minLength) return false;
      if (param.maxLength !== undefined && value.length > param.maxLength) return false;
      break;
    default:
      return false;
  }
  if (param.enum && !param.enum.includes(value as string | number)) return false;
  if (typeof value === 'number') {
    if (param.minimum !== undefined && value < param.minimum) return false;
    if (param.maximum !== undefined && value > param.maximum) return false;
  }
  return true;
}

/** Each field's value when it fits, else its default when that fits, else nothing. Undeclared names go. */
function fitFields(fields: CapField[], values: CapValues | undefined): CapValues {
  const out: CapValues = {};
  for (const { name, param } of fields) {
    const value = values?.[name];
    if (fitsParam(param, value)) out[name] = value;
    else if (fitsParam(param, param.default)) out[name] = param.default;
  }
  return out;
}

/** The common parameters a card sends: its values where they fit the model, defaults elsewhere. */
export function effectiveParams(cap: CapabilityDescriptor | undefined, values: CapValues | undefined): CapValues {
  return fitFields(specFields(cap), values);
}

/** The vendor options a card sends, by namespace; namespaces left empty are omitted. */
export function effectiveOptions(cap: CapabilityDescriptor | undefined, options: CapOptions | undefined): CapOptions {
  const out: CapOptions = {};
  for (const { ns, fields } of optionGroups(cap)) {
    const values = fitFields(fields, options?.[ns]);
    if (Object.keys(values).length) out[ns] = values;
  }
  return out;
}

/**
 * Switching a card to a Heighliner model: values that no longer fit fall back to the new
 * model's defaults, and fields it does not declare are dropped.
 */
export function capValuesPatch(
  cap: CapabilityDescriptor | undefined,
  card: Pick<SpatialCard, 'capParams' | 'capOptions'>
): Pick<SpatialCard, 'capParams' | 'capOptions'> {
  return { capParams: effectiveParams(cap, card.capParams), capOptions: effectiveOptions(cap, card.capOptions) };
}

/** Sets (or, with undefined, clears) one value; a cleared field falls back to its default when sent. */
export function withValue(values: CapValues | undefined, name: string, value: CapValue | undefined): CapValues {
  const next = { ...values };
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
}

export function withOption(options: CapOptions | undefined, ns: string, name: string, value: CapValue | undefined): CapOptions {
  const next = { ...options, [ns]: withValue(options?.[ns], name, value) };
  if (Object.keys(next[ns]).length === 0) delete next[ns];
  return next;
}

/** "3–15" for a ranged number, "" when it has no bounds. */
export function rangeText(param: CapabilityParam): string {
  if (param.minimum === undefined && param.maximum === undefined) return '';
  return `${param.minimum ?? '…'}–${param.maximum ?? '…'}`;
}

/** Clamps a typed number into the parameter's range (integers rounded); undefined for non-numbers. */
export function clampNumber(param: CapabilityParam, raw: string): number | undefined {
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(n)) return undefined;
  let v = param.type === 'integer' ? Math.round(n) : n;
  if (param.minimum !== undefined) v = Math.max(v, param.minimum);
  if (param.maximum !== undefined) v = Math.min(v, param.maximum);
  return v;
}

// --- References ------------------------------------------------------------------

/** Media type of a reference role on a card: reference videos are videos, everything else images. */
export type RefMedia = 'image' | 'video' | 'audio';

/** The descriptor's entry for a gateway role and media type, if the model takes it. */
export function referenceSlot(cap: CapabilityDescriptor | undefined, role: string, type: RefMedia) {
  return cap?.references?.find((r) => r.role === role && (r.types ?? []).includes(type));
}

/** How many references of a role and type the model takes; 0 when it takes none. */
export function slotLimit(cap: CapabilityDescriptor | undefined, role: string, type: RefMedia): number {
  const slot = referenceSlot(cap, role, type);
  return slot ? slot.max_count ?? 1 : 0;
}

/** Gateway role and type an asset-library item of each kind goes as. */
export const ASSET_SLOT: Record<AssetKind, { role: string; type: RefMedia }> = {
  image: { role: 'reference', type: 'image' },
  video: { role: 'reference', type: 'video' },
  audio: { role: 'voice', type: 'audio' },
};

/** Kinds of asset-library items the model takes by asset ID (multi-reference mode). */
export function capAssetKinds(cap: CapabilityDescriptor | undefined): AssetKind[] {
  return (Object.keys(ASSET_SLOT) as AssetKind[]).filter((kind) => {
    const { role, type } = ASSET_SLOT[kind];
    return !!referenceSlot(cap, role, type)?.supports_asset;
  });
}

/** Video modes the model's reference roles open: 全能参考 needs `reference`, 首尾帧 `first_frame`. */
export function capVideoModes(cap: CapabilityDescriptor | undefined): VideoTaskMode[] {
  const modes: VideoTaskMode[] = [];
  if (slotLimit(cap, 'reference', 'image') + slotLimit(cap, 'reference', 'video') > 0) modes.push('all_modal');
  if (slotLimit(cap, 'first_frame', 'image') > 0) modes.push('first_last_frame');
  modes.push('text_to_video');
  return modes;
}

/** How many references of `kind` a video card takes in `mode`, connected cards and assets together. */
export function capReferenceLimit(cap: CapabilityDescriptor | undefined, mode: VideoTaskMode, kind: AssetKind): number {
  if (mode === 'text_to_video') return 0;
  if (mode === 'first_last_frame') {
    return kind === 'image' ? slotLimit(cap, 'first_frame', 'image') + Math.min(1, slotLimit(cap, 'last_frame', 'image')) : 0;
  }
  const { role, type } = ASSET_SLOT[kind];
  return slotLimit(cap, role, type);
}

function enumOf<T extends string | number>(param: CapabilityParam | undefined): T[] {
  return (param?.enum ?? []) as T[];
}

/** Durations a model offers: its enum, or every second of a short range, else its default. */
function durationsOf(param: CapabilityParam | undefined): number[] {
  if (!param) return [];
  if (param.enum) return enumOf<number>(param);
  const { minimum: min, maximum: max } = param;
  if (min !== undefined && max !== undefined && max - min <= 60) {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }
  return typeof param.default === 'number' ? [param.default] : [];
}

/** A built-in-style model definition read off the descriptor, for the rules shared with other video providers. */
export function capVideoDef(cap: CapabilityDescriptor | undefined, modelId: string): VideoModelDef {
  const p = cap?.parameters ?? {};
  const modes = capVideoModes(cap);
  const capacity = Math.max(
    ...modes.map((m) => capReferenceLimit(cap, m, 'image') + capReferenceLimit(cap, m, 'video'))
  );
  return {
    id: modelId,
    name: modelId,
    tag: '',
    protocol: 'heighliner',
    resolutions: enumOf<string>(p.resolution),
    durations: durationsOf(p.duration),
    ratios: enumOf<string>(p.aspect_ratio),
    supportsAudio: !!p.generate_audio,
    supportsMov: false,
    maxRefs: capacity,
    maxAudioRefs: capReferenceLimit(cap, 'all_modal', 'audio'),
    modes,
  };
}
