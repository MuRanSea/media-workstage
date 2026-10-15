import type { CapOptions, ReferenceItem, ResultActionDto, SpatialCard, VideoTaskMode } from '../types/canvas.ts';
import type { CapabilityDescriptor, CreateTaskPayload, ProviderId } from '../services/api.ts';
import type { ImageCompilationInput } from './compiler.ts';
import {
  ASSET_SLOT,
  FINAL_RESOLUTION,
  capVideoModes,
  effectiveOptions,
  effectiveParams,
  referenceSlot,
  requireCapability,
  sentOptions,
  sentParams,
  type RefMedia,
} from './capability.ts';
import { refNoun } from './refTags.ts';
import { VIEW_LABELS, viewOf } from './model3d.ts';
import { PROMPT_MAX_BYTES, apply3DRules, applyVideoRules, checkImageRules, isKlingOmni, promptBytes } from './heighlinerRules.ts';
import { resolveReferenceAsset, sentVideoSettings } from './videoCompiler.ts';

/**
 * Heighliner payloads (ADR 0010): `params.parameters` holds the common parameters the model
 * declares, `params.provider_options` the vendor options by namespace, and each reference
 * names the gateway role and its media type. The adapter only assembles and sends them.
 */

type CompiledRef = NonNullable<CreateTaskPayload['reference_assets']>[number];

const MODE_LABELS: Record<VideoTaskMode, string> = {
  all_modal: '多图参考',
  first_last_frame: '首尾帧',
  text_to_video: '纯文字',
};

const SLOT_LABELS: Record<string, string> = {
  'reference|image': '参考图',
  'reference|video': '参考视频',
  'voice|audio': '参考音频',
  'first_frame|image': '首帧',
  'last_frame|image': '尾帧',
  // 3D views: "不支持「左」视角的参考图".
  ...Object.fromEntries(
    Object.entries(VIEW_LABELS)
      .filter(([role]) => role !== 'reference')
      .map(([role, label]) => [`${role}|image`, `「${label}」视角的参考图`])
  ),
};

/** A connected card sent as `role`; whether it may go as an asset ID is the role's call. */
function connectedRef(
  cap: CapabilityDescriptor,
  model: string,
  ref: ReferenceItem,
  role: string,
  type: RefMedia,
  tagIndex: number,
  allCards: SpatialCard[]
): CompiledRef {
  const slot = referenceSlot(cap, role, type);
  if (!slot) throw new Error(`${model} 不支持${SLOT_LABELS[`${role}|${type}`] ?? `${role} 角色的${type}`}`);
  const resolved = resolveReferenceAsset(ref, allCards, 'heighliner', !!slot.supports_asset);
  return withoutEmpty({
    card_id: ref.cardId,
    tag_index: tagIndex,
    role,
    type,
    label: ref.label,
    url: resolved.url,
    local_path: resolved.localPath,
    remote_url: resolved.remoteUrl,
  });
}

function withoutEmpty(ref: CompiledRef): CompiledRef {
  return Object.fromEntries(Object.entries(ref).filter(([, v]) => v !== undefined)) as CompiledRef;
}

/** Each role and type takes at most its `max_count`. */
function checkCounts(cap: CapabilityDescriptor, model: string, refs: CompiledRef[]): void {
  const counts = new Map<string, number>();
  for (const r of refs) counts.set(`${r.role}|${r.type}`, (counts.get(`${r.role}|${r.type}`) ?? 0) + 1);
  for (const [key, n] of counts) {
    const [role, type] = key.split('|');
    const max = referenceSlot(cap, role, type as RefMedia)?.max_count ?? 1;
    if (n > max) throw new Error(`${model} 最多 ${max} 个${SLOT_LABELS[key] ?? key}，当前 ${n} 个`);
  }
}

/** Kling Omni names images in its prompt as <<<image_1>>>, numbered in send order. */
const klingImageTag = (n: number) => `<<<image_${n}>>>`;

/**
 * Renumbers @图N / @视频N mentions to the order references are sent in (图1, 图2 … and
 * 视频1 …, counted separately), in one pass so a renumbered mention is never matched again.
 * `imageTag` writes an image mention in a model's own syntax (Kling Omni's <<<image_N>>>).
 */
function renumberPrompt(prompt: string, refs: ReferenceItem[], imageTag?: (n: number) => string): string {
  const counters = { 图: 0, 视频: 0 };
  const sentIndex = { 图: new Map<number, number>(), 视频: new Map<number, number>() };
  for (const ref of refs) {
    const noun = refNoun(ref.role);
    const index = ++counters[noun];
    if (!sentIndex[noun].has(ref.tagIndex)) sentIndex[noun].set(ref.tagIndex, index);
  }
  return prompt
    .replace(/@?(图|视频)(\d+)\b/g, (mention, noun: '图' | '视频', n: string) => {
      const index = sentIndex[noun].get(Number(n));
      if (index === undefined) return mention;
      return noun === '图' && imageTag ? imageTag(index) : `${noun}${index}`;
    })
    .replace(/@(图|视频)(\d+)/g, '$1$2')
    .trim();
}

/**
 * The prompt as the model's `prompt` parameter allows it: required ones may not be empty,
 * none may run past its length, and no media prompt past 32,000 bytes.
 */
function checkPrompt(cap: CapabilityDescriptor, prompt: string): string {
  const param = cap.parameters?.prompt;
  if (param?.required && !prompt) throw new Error('请先填写提示词');
  if (param?.maxLength !== undefined && prompt.length > param.maxLength) {
    throw new Error(`提示词最长 ${param.maxLength} 个字，当前 ${prompt.length} 个`);
  }
  const bytes = promptBytes(prompt);
  if (bytes > PROMPT_MAX_BYTES) throw new Error(`提示词最长 ${PROMPT_MAX_BYTES} 字节，当前 ${bytes} 字节`);
  return prompt;
}

function compiledParams(parameters: Record<string, unknown>, options: CapOptions) {
  return Object.keys(options).length ? { parameters, provider_options: options } : { parameters };
}

export function compileHeighlinerImagePayload(provider: ProviderId, input: ImageCompilationInput): CreateTaskPayload {
  const cap = requireCapability({ provider, model: input.model });
  const refs = input.references ?? [];
  const references = refs.map((ref, i) =>
    connectedRef(cap, input.model, ref, 'reference', 'image', i + 1, input.allCards ?? [])
  );
  checkCounts(cap, input.model, references);
  const parameters = effectiveParams(cap, input.capParams);
  checkImageRules(cap, parameters, references.length);
  const payload: CreateTaskPayload = {
    provider,
    model: input.model,
    task_type: 'image_generation',
    task_mode: 'single',
    prompt: checkPrompt(cap, renumberPrompt(input.prompt, refs)),
    params: compiledParams(parameters, effectiveOptions(cap, input.capOptions)),
  };
  if (references.length) payload.reference_assets = references;
  return payload;
}

export function compileHeighlinerVideoPayload(card: SpatialCard, allCards: SpatialCard[] = []): CreateTaskPayload {
  const cap = requireCapability(card);
  const { mode, references: refs } = sentVideoSettings(card);
  if (!capVideoModes(cap).includes(mode)) throw new Error(`${card.model} 不支持「${MODE_LABELS[mode]}」模式`);

  const counters = { image: 0, video: 0, audio: 0 };
  const references = refs.map((ref) => {
    const type: RefMedia = ref.role === 'reference_video' ? 'video' : 'image';
    const role = mode === 'first_last_frame' ? ref.role : 'reference';
    return connectedRef(cap, card.model, ref, role, type, ++counters[type], allCards);
  });

  // Asset-library items (multi-reference mode) go by asset ID, numbered after the connected cards of their kind.
  for (const asset of mode === 'all_modal' ? card.assetRefs ?? [] : []) {
    const { role, type } = ASSET_SLOT[asset.kind];
    if (!referenceSlot(cap, role, type)?.supports_asset) {
      throw new Error(`${card.model} 的${SLOT_LABELS[`${role}|${type}`]}不支持素材 ID，请移除素材「${asset.assetId}」`);
    }
    references.push({
      card_id: '',
      tag_index: ++counters[asset.kind],
      role,
      type,
      label: asset.assetId,
      url: `asset://${asset.assetId}`,
    });
  }
  checkCounts(cap, card.model, references);

  const imageTag = isKlingOmni(cap) && mode === 'all_modal' ? klingImageTag : undefined;
  const prompt =
    mode === 'text_to_video' ? card.prompt.replace(/@?(图|视频)\d+\s*/g, '').trim() : renumberPrompt(card.prompt, refs, imageTag);
  if (!prompt && references.length === 0) throw new Error('请先填写提示词');

  const parameters = sentParams(cap, card);
  // First/last frame: the frame sets the shape; send "adaptive" where the model has it, else no ratio.
  if (mode === 'first_last_frame') {
    if (cap.parameters?.aspect_ratio?.enum?.includes('adaptive')) parameters.aspect_ratio = 'adaptive';
    else delete parameters.aspect_ratio;
  }
  const options = sentOptions(cap, card);
  applyVideoRules(cap, {
    mode,
    imageRefs: references.filter((r) => r.role === 'reference' && r.type === 'image').length,
    videoRefs: references.filter((r) => r.type === 'video').length,
    parameters,
    options,
  });

  const payload: CreateTaskPayload = {
    provider: card.provider!,
    model: card.model,
    task_type: 'video_generation',
    task_mode: mode,
    prompt: checkPrompt(cap, prompt),
    params: compiledParams(parameters, options),
  };
  if (references.length) payload.reference_assets = references;
  return payload;
}

/**
 * 生成正式视频: renders the full video from the finished sample on result card `source`. The
 * gateway inherits prompt, references, duration, ratio, seed and audio from the sample and
 * refuses them sent again, so only the resolution (explicit, 1080p) goes along with the sample's
 * task; the backend adds the gateway task ID after checking the sample offered this action.
 */
export function compileFinalizePayload(source: SpatialCard, action: ResultActionDto): CreateTaskPayload {
  if (!source.taskId || source.status !== 'succeeded') throw new Error(`「${source.title}」还没有可以操作的生成结果`);
  return {
    provider: source.provider!,
    model: source.model,
    task_type: 'video_generation',
    task_mode: 'action',
    // Only recorded; the gateway takes the prompt from the sample.
    prompt: source.prompt.trim() || action.label || '生成正式视频',
    params: { parameters: { resolution: FINAL_RESOLUTION }, source_task_id: source.taskId, action_id: action.id },
  };
}

/**
 * A 3D card: each connected image goes as its view's role (主图 = `reference`). The model's
 * rules (heighlinerRules.apply3DRules) decide whether the prompt goes along with images and
 * which role a 主图 takes among other views.
 */
export function compileHeighliner3DPayload(card: SpatialCard, allCards: SpatialCard[] = []): CreateTaskPayload {
  const cap = requireCapability(card);
  const refs = card.references ?? [];
  const typed = card.prompt.trim();
  if (!typed && refs.length === 0) throw new Error('请先填写提示词，或连入参考图');

  const parameters = effectiveParams(cap, card.capParams);
  const options = effectiveOptions(cap, card.capOptions);
  const { prompt, roles } = apply3DRules(cap, { prompt: typed, roles: refs.map(viewOf), parameters, options });
  const references = refs.map((ref, i) => connectedRef(cap, card.model, ref, roles[i], 'image', i + 1, allCards));
  checkCounts(cap, card.model, references);

  const payload: CreateTaskPayload = {
    provider: card.provider!,
    model: card.model,
    task_type: '3d_generation',
    task_mode: 'single',
    prompt: checkPrompt(cap, prompt),
    params: compiledParams(parameters, options),
  };
  if (references.length) payload.reference_assets = references;
  return payload;
}
