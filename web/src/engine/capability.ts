import type { CapabilityDescriptor, CapabilityOperation, CapabilityParam, ProviderId } from '../services/api.ts';
import type { AssetKind, CapOptions, CapValue, CapValues, SpatialCard, VideoModelDef, VideoTaskMode } from '../types/canvas.ts';
import { isKling4, isKlingOmni, supportsKlingMultiShot } from './heighlinerRules.ts';
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

/** Common parameters the 规格 page shows, in display order. `prompt` has its own input. */
export const SPEC_PARAMS = [
  'aspect_ratio',
  'resolution',
  'duration',
  'n',
  'generate_audio',
  'seed',
  'negative_prompt',
  'output_format',
  'size',
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
  size: '尺寸（选填，覆盖比例和清晰度）',
};

export interface CapField {
  name: string;
  param: CapabilityParam;
}

const SCALAR_TYPES: ReadonlySet<string> = new Set(['string', 'integer', 'number', 'boolean']);

/** The common parameters this model declares, in display order. */
export function specFields(cap: CapabilityDescriptor | undefined): CapField[] {
  const params = cap?.parameters ?? {};
  return SPEC_PARAMS.filter((name) => params[name] && SCALAR_TYPES.has(params[name].type) && (name !== 'size' || cap?.type === 'image')).map((name) => ({
    name,
    param: name === 'size' || (isKling4(cap) && (name === 'duration' || name === 'aspect_ratio')) ? { ...params[name], default: undefined } : params[name],
  }));
}

/**
 * Vendor options a card sets through a control of its own, never as a generic field: the
 * Seedance 2.5 sample switch and the sample a final video is made from.
 */
const MANAGED_OPTIONS: ReadonlySet<string> = new Set(['volcengine.draft', 'volcengine.draft_task_id']);

/** Vendor options by namespace (`provider_options.<ns>`), scalar fields only. */
export function optionGroups(cap: CapabilityDescriptor | undefined): { ns: string; fields: CapField[] }[] {
  if (!cap) return [];
  const namespaces = { ...cap.provider_options_schema?.properties };
  return Object.entries(namespaces)
    .map(([ns, schema]) => ({
      ns,
      fields: [...Object.entries(schema.properties ?? {}), ...nestedImageOptions(cap, ns, schema)]
        .filter(([name, param]) => SCALAR_TYPES.has(param.type) && !MANAGED_OPTIONS.has(`${ns}.${name}`))
        .filter(([name, param]) => ns !== 'kling' || name !== 'multi_shot' || (param.type === 'boolean' && supportsKlingMultiShot(cap)))
        // Omission is significant for Omni with a reference clip, even if the catalog says default=false.
        .map(([name, param]) => ({ name, param: ns === 'kling' && name === 'multi_shot' ? { ...param, default: undefined } : param })),
    }))
    .filter((g) => g.fields.length > 0);
}

function nestedImageOptions(cap: CapabilityDescriptor, ns: string, schema: CapabilityParam): [string, CapabilityParam][] {
  if (cap.type !== 'image' || ns !== 'volcengine') return [];
  const fields: [string, CapabilityParam][] = [];
  const nested = (key: string, name: string, param: CapabilityParam) => {
    if (schema.properties?.[key]?.type === 'object') fields.push([`${key}.${name}`, param]);
  };
  if (cap.id === 'doubao-seedream-5-5-261028') {
    nested('layer_decomposition_options', 'max_images', { type: 'integer', minimum: 2, maximum: 100 });
    nested('layer_decomposition_options', 'text_recognition', { type: 'boolean' });
  }
  if (['doubao-seedream-5-5-261028', 'doubao-seedream-5-0-flash-260915'].includes(cap.id)) {
    nested('optimize_prompt_options', 'mode', { type: 'string', enum: ['standard'] });
  }
  return fields;
}

// --- Seedance 2.5 samples (样片) --------------------------------------------------

export const SAMPLE_RESOLUTION = '480p';

export function finalResolution(actionId: string | undefined): '1080p' | '4k' | undefined {
  if (actionId === 'finalize') return '1080p';
  if (actionId === 'finalize_4k') return '4k';
  return undefined;
}

/**
 * Whether a Heighliner video card can render a sample: only Seedance 2.5 can. The gateway's
 * catalog does not list `draft` among the vendor options, so the model decides.
 */
export function supportsSample(card: Pick<SpatialCard, 'provider' | 'model' | 'type'>): boolean {
  return card.type === 'video' && isHeighliner(card.provider) && card.model === 'doubao-seedance-2-5-260628';
}

/** Whether the card is set to render a sample (and could). */
export function isSampleRun(card: Pick<SpatialCard, 'provider' | 'model' | 'type' | 'sampleMode'>): boolean {
  return !!card.sampleMode && supportsSample(card);
}

/** The common parameters a card sends: its own, fitted to the model, with a sample's resolution fixed. */
export function sentParams(cap: CapabilityDescriptor | undefined, card: Pick<SpatialCard, 'provider' | 'model' | 'type' | 'sampleMode' | 'capParams' | 'role' | 'origin'>): CapValues {
  const params = effectiveParams(cap, card.capParams);
  // Sample actions have their own documented resolutions, independent of the ordinary model catalog.
  const resolution = card.role === 'result' && supportsSample(card) ? finalResolution(card.origin?.actionId) : undefined;
  if (resolution) return { ...params, resolution };
  return isSampleRun(card) ? { ...params, resolution: SAMPLE_RESOLUTION } : params;
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
function fitFields(fields: CapField[], values: CapValues | undefined, defaults = true): CapValues {
  const out: CapValues = {};
  for (const { name, param } of fields) {
    const value = values?.[name];
    if (fitsParam(param, value)) out[name] = value;
    else if (defaults && fitsParam(param, param.default)) out[name] = param.default;
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
  const capOptions: CapOptions = {};
  for (const { ns, fields } of optionGroups(cap)) {
    const explicit = fitFields(fields, card.capOptions?.[ns], false);
    if (Object.keys(explicit).length) capOptions[ns] = explicit;
  }
  return { capParams: fitFields(specFields(cap), card.capParams, false), capOptions };
}

/** Before v0.3 a model switch persisted defaults as if the user typed them. Keep the old
 * request intact until switching models or editing controls. Only non-default legacy values
 * are known overrides; new cards preserve even explicitly selected default values. */
export function explicitVideoParams(card: SpatialCard): CapValues {
  const values = { ...card.capParams };
  if (card.type === 'video' && card.capInputVersion !== 1) {
    for (const {name, param} of specFields(activeCapability(card))) {
      if (values[name] === param.default) delete values[name];
    }
  }
  return values;
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

// --- Video editing (operation=edit) ---------------------------------------------------

/** The `operation` a video edit is requested with, and the role its source video goes as. */
export const EDIT_OPERATION = 'edit';
export const EDIT_SOURCE_ROLE = 'source';
export const MOTION_OPERATION = 'motion_control';

const KLING_MOTION: CapabilityOperation = {
  references: [{ role: 'character', types: ['image'], max_count: 1 }, { role: 'motion', types: ['video'], max_count: 1 }],
  parameters: {
    prompt: { type: 'string', required: true, maxLength: 2500 },
    resolution: { type: 'string', enum: ['720p', '1080p'], default: '720p' },
  },
  provider_options_schema: { type: 'object', properties: {
    kling: { type: 'object', properties: {
      character_orientation: { type: 'string', enum: ['image', 'video'] },
      audio: { type: 'string', enum: ['original', 'off'] },
    } },
  } },
};

function motionOperation(cap?: CapabilityDescriptor): CapabilityOperation | undefined {
  if (cap?.id !== 'kling-3.0') return undefined;
  return cap.operations?.[MOTION_OPERATION] ?? (cap.operations === undefined ? KLING_MOTION : undefined);
}

function kling4References(cap: CapabilityDescriptor, edit: boolean): CapabilityDescriptor['references'] {
  return [
    { role: 'first_frame', types: ['image'], max_count: 1 },
    ...(cap.id === 'kling-4.0' ? [{ role: 'middle_frame', types: ['image'], max_count: 10 }, { role: 'last_frame', types: ['image'], max_count: 1 }] : []),
    { role: 'reference', types: ['image'], max_count: 10 },
    { role: 'reference', types: ['video'], max_count: 5 },
    ...(edit ? [{ role: 'source', types: ['video'], max_count: 1 }] : []),
  ];
}

/** Kling Omni's edit as the docs give it, for descriptors that do not list `operations` yet. */
const KLING_OMNI_EDIT: CapabilityOperation = {
  references: [
    { role: EDIT_SOURCE_ROLE, types: ['video'], max_count: 1, max_bytes: 200 * 1024 * 1024 },
    { role: 'reference', types: ['image'], max_count: 4, max_bytes: 10 * 1024 * 1024 },
  ],
  provider_options_schema: {
    type: 'object',
    properties: {
      kling: {
        type: 'object',
        properties: {
          // original keeps the source video's own sound; both cost the same.
          audio: { type: 'string', enum: ['off', 'original'], default: 'off' },
        },
      },
    },
  },
};

/** The model's edit operation: as its descriptor declares it, else Kling Omni's documented one. */
export function editOperation(cap: CapabilityDescriptor | undefined): CapabilityOperation | undefined {
  if (!cap || cap.type !== 'video') return undefined;
  if (cap.operations?.[EDIT_OPERATION]) return cap.operations[EDIT_OPERATION];
  if (isKling4(cap) && cap.operations === undefined) return { references: kling4References(cap, true) };
  return cap.operations === undefined && isKlingOmni(cap) ? KLING_OMNI_EDIT : undefined;
}

function mergeOptionSchemas(base: CapabilityParam | undefined, extra: CapabilityParam | undefined): CapabilityParam | undefined {
  if (!extra) return base;
  if (!base) return extra;
  const properties: Record<string, CapabilityParam> = { ...base.properties };
  for (const [ns, schema] of Object.entries(extra.properties ?? {})) {
    const own = properties[ns];
    properties[ns] = own ? { ...own, ...schema, properties: { ...own.properties, ...schema.properties } } : schema;
  }
  return { ...base, properties };
}

/**
 * The descriptor as it applies to `mode`. Editing a video follows the edit operation's
 * declarations over the model's own (its sound is `kling.audio`, never `generate_audio`);
 * ordinary Kling generation can also declare its options under `operations.generate`.
 */
export function modeCapability(cap: CapabilityDescriptor | undefined, mode: VideoTaskMode | undefined): CapabilityDescriptor | undefined {
  const edit = mode === 'video_edit' ? editOperation(cap) : undefined;
  if (!cap) return undefined;
  if (mode === 'motion_control') {
    const motion = motionOperation(cap);
    if (!motion) return undefined;
    const schema = mergeOptionSchemas(cap.provider_options_schema, motion.provider_options_schema);
    const kling = schema?.properties?.kling;
    const { multi_shot: _multi, ...properties } = kling?.properties ?? {};
    const { aspect_ratio: _ratio, duration: _duration, generate_audio: _audio, ...parameters } = { ...motion.parameters, ...KLING_MOTION.parameters };
    return { ...cap, parameters, references: motion.references ?? KLING_MOTION.references,
      provider_options_schema: { type: 'object', properties: { kling: { type: 'object', properties } } } };
  }
  if (isKling4(cap)) {
    const generate = cap.operations?.generate;
    const op = edit ?? generate;
    const { generate_audio: _audio, ...parameters } = { ...cap.parameters, ...op?.parameters };
    let schema = mergeOptionSchemas(cap.provider_options_schema, op?.provider_options_schema);
    const kling = schema?.properties?.kling;
    const { audio: _oldAudio, multi_shot: _multiShot, ...remainingKling } = kling?.properties ?? {};
    const usesOmniAudio = mode === 'all_modal' || mode === 'video_edit';
    schema = { ...schema, type: 'object', properties: { ...schema?.properties, kling: {
      ...kling, type: 'object', properties: { ...remainingKling, ...(usesOmniAudio ? { audio: { type: 'string', enum: ['native', 'original'] } } : {}) },
    } } };
    const flash = cap.id === 'kling-4.0-flash';
    parameters.resolution = { type: 'string', enum: flash ? ['720p'] : ['720p', '1080p'], default: flash ? '720p' : '1080p' };
    parameters.duration = { type: 'integer', minimum: 3, maximum: flash ? 20 : 30 };
    if (mode === 'text_to_video') parameters.aspect_ratio = { type: 'string', enum: ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'] };
    if (mode === 'all_modal' || mode === 'video_edit') parameters.aspect_ratio = { type: 'string', enum: ['adaptive', '21:9', '16:9', '9:16', '1:1', '4:3', '3:4'] };
    return { ...cap, parameters, references: op?.references ?? (edit ? kling4References(cap, true) : cap.references ?? kling4References(cap, false)), provider_options_schema: schema };
  }
  if (!edit) {
    const generate = cap.operations?.generate?.provider_options_schema;
    return generate && mode !== 'video_edit' && supportsKlingMultiShot(cap)
      ? { ...cap, provider_options_schema: mergeOptionSchemas(cap.provider_options_schema, generate) }
      : cap;
  }
  let scheme = mergeOptionSchemas(cap.provider_options_schema, edit.provider_options_schema);
  const kling = scheme?.properties?.kling;
  if (kling && scheme?.properties) {
    const { multi_shot: _multiShot, ...properties } = kling.properties ?? {};
    scheme = { ...scheme, properties: { ...scheme.properties, kling: { ...kling, properties } } };
  }
  const { generate_audio: _audio, ...parameters } = { ...cap.parameters, ...edit.parameters };
  return {
    ...cap,
    parameters,
    references: edit.references ?? cap.references,
    provider_options_schema: scheme,
  };
}

/** A card's descriptor for the mode it is set to: what its 规格 shows and what it sends. */
export function activeCapability(card: Pick<SpatialCard, 'provider' | 'model' | 'mode'>): CapabilityDescriptor | undefined {
  return modeCapability(cardCapability(card), card.mode);
}

/** Video modes the model's reference roles open: 全能参考 needs `reference`, 首尾帧 `first_frame`, 视频编辑 an edit operation. */
export function capVideoModes(cap: CapabilityDescriptor | undefined): VideoTaskMode[] {
  const modes: VideoTaskMode[] = [];
  const generate = modeCapability(cap, 'all_modal');
  if (slotLimit(generate, 'reference', 'image') + slotLimit(generate, 'reference', 'video') + slotLimit(generate, 'voice', 'audio') > 0) modes.push('all_modal');
  if (slotLimit(generate, 'first_frame', 'image') > 0) modes.push('first_last_frame');
  if (motionOperation(cap)) modes.push('motion_control');
  if (slotLimit(modeCapability(cap, 'video_edit'), EDIT_SOURCE_ROLE, 'video') > 0) modes.push('video_edit');
  modes.push('text_to_video');
  return modes;
}

/** How many references of `kind` a video card takes in `mode`, connected cards and assets together. */
export function capReferenceLimit(cap: CapabilityDescriptor | undefined, mode: VideoTaskMode, kind: AssetKind): number {
  if (mode === 'text_to_video') return 0;
  if (mode === 'motion_control') return kind === 'audio' ? 0 : slotLimit(modeCapability(cap, mode), kind === 'image' ? 'character' : 'motion', kind);
  if (isKling4(cap)) {
    const view = modeCapability(cap, mode);
    if (mode === 'first_last_frame') return kind === 'image' ? Math.min(10, ['first_frame', 'middle_frame', 'last_frame'].reduce((n, role) => n + slotLimit(view, role, 'image'), 0)) : 0;
    return kind === 'image' ? 10 : kind === 'video' ? 5 : 0;
  }
  if (mode === 'video_edit') {
    const edit = modeCapability(cap, mode);
    return kind === 'video' ? slotLimit(edit, EDIT_SOURCE_ROLE, 'video') : kind === 'image' ? slotLimit(edit, 'reference', 'image') : 0;
  }
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
