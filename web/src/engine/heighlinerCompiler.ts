import type { CapOptions, ReferenceItem, ResultActionDto, SpatialCard, VideoTaskMode } from '../types/canvas.ts';
import type { CapabilityDescriptor, CreateTaskPayload, ProviderId } from '../services/api.ts';
import type { ImageCompilationInput } from './compiler.ts';
import {
  ASSET_SLOT,
  EDIT_OPERATION,
  EDIT_SOURCE_ROLE,
  MOTION_OPERATION,
  finalResolution,
  supportsSample,
  capVideoModes,
  effectiveOptions,
  effectiveParams,
  modeCapability,
  referenceSlot,
  requireCapability,
  sentOptions,
  sentParams,
  type RefMedia,
} from './capability.ts';
import { mediaKindOf } from './uploadRefs.ts';
import { refNoun } from './refTags.ts';
import { VIEW_LABELS, viewOf } from './model3d.ts';
import { PROMPT_MAX_BYTES, apply3DRules, applyVideoRules, checkImageRules, isSeedance25, isMiniMaxH3, isKling4, isKlingOmni, promptBytes } from './heighlinerRules.ts';
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
  video_edit: '视频编辑',
  motion_control: '动作控制',
};

const SLOT_LABELS: Record<string, string> = {
  'reference|image': '参考图',
  'reference|video': '参考视频',
  'source|video': '要编辑的视频',
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
  allCards: SpatialCard[],
  provider: ProviderId
): CompiledRef {
  const slot = referenceSlot(cap, role, type);
  if (!slot) throw new Error(`${model} 不支持${SLOT_LABELS[`${role}|${type}`] ?? `${role} 角色的${type}`}`);
  const source = allCards.find((c) => c.id === ref.cardId);
  if (source && mediaKindOf(source) !== type) throw new Error('参考素材类型与所选角色不匹配，请重新连接');
  const managed = source?.gatewayFile;
  if (managed) {
    if (managed.provider !== provider) throw new Error('平台文件只能在原服务商下引用');
    if (managed.expiresAt && managed.expiresAt <= Date.now() / 1000) throw new Error('平台文件已过期，请重新导入');
    if (managed.assetId ? !slot.supports_asset : slot.requires_asset) throw new Error('此素材角色不支持该来源');
    return { card_id: ref.cardId, tag_index: tagIndex, role, type, label: ref.label,
      ...(managed.assetId ? { url: `asset://${managed.assetId}` } : { file_id: managed.id }) };
  }
  const resolved = resolveReferenceAsset(ref, allCards, 'heighliner', !!slot.supports_asset);
  if (slot.requires_asset && !resolved.url?.startsWith('asset://')) throw new Error('该角色仅接受审核通过的素材 ID');
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
  const counters = { 图: 0, 视频: 0, 音频: 0 };
  const sentIndex = { 图: new Map<number, number>(), 视频: new Map<number, number>(), 音频: new Map<number, number>() };
  for (const ref of refs) {
    const noun = refNoun(ref.role);
    const index = ++counters[noun];
    if (!sentIndex[noun].has(ref.tagIndex)) sentIndex[noun].set(ref.tagIndex, index);
  }
  return prompt
    .replace(/@?(图|视频|音频)(\d+)\b/g, (mention, noun: '图' | '视频' | '音频', n: string) => {
      const index = sentIndex[noun].get(Number(n));
      if (index === undefined) return mention;
      return noun === '图' && imageTag ? imageTag(index) : `${noun}${index}`;
    })
    .replace(/@(图|视频|音频)(\d+)/g, '$1$2')
    .trim();
}

/**
 * The prompt as the model's `prompt` parameter allows it: required ones may not be empty,
 * none may run past its length, and no media prompt past 32,000 bytes.
 */
function checkPrompt(cap: CapabilityDescriptor, prompt: string, required = cap.parameters?.prompt?.required): string {
  const param = cap.parameters?.prompt;
  if (required && !prompt) throw new Error('请先填写提示词');
  if (param?.maxLength !== undefined && prompt.length > param.maxLength) {
    throw new Error(`提示词最长 ${param.maxLength} 个字，当前 ${prompt.length} 个`);
  }
  const bytes = promptBytes(prompt);
  if (bytes > PROMPT_MAX_BYTES) throw new Error(`提示词最长 ${PROMPT_MAX_BYTES} 字节，当前 ${bytes} 字节`);
  return prompt;
}

function compiledParams(parameters: Record<string, unknown>, options: CapOptions) {
  const provider_options = Object.fromEntries(Object.entries(options).map(([ns, fields]) => {
    const scalars = Object.entries(fields).filter(([key]) => !key.includes('.'));
    const nested: Record<string, Record<string, (typeof fields)[string]>> = {};
    for (const [key, value] of Object.entries(fields)) {
      const [object, child] = key.split('.');
      if (child) (nested[object] ??= {})[child] = value;
    }
    return [ns, { ...Object.fromEntries(scalars), ...nested }];
  }));
  return Object.keys(provider_options).length ? { parameters, provider_options } : { parameters };
}

export function compileHeighlinerImagePayload(provider: ProviderId, input: ImageCompilationInput): CreateTaskPayload {
  const cap = requireCapability({ provider, model: input.model });
  const refs = input.references ?? [];
  const options = effectiveOptions(cap, input.capOptions);
  const decompose = ['doubao-seedream-5-5-261028', 'doubao-seedream-5-0-flash-260915'].includes(cap.id) && options.volcengine?.layer_decomposition === true;
  if (decompose && refs.length !== 1) throw new Error('自动拆图需要恰好 1 张参考图');
  if (decompose) delete options.volcengine.background;
  else if (options.volcengine) {
    delete options.volcengine['layer_decomposition_options.max_images'];
    delete options.volcengine['layer_decomposition_options.text_recognition'];
  }
  if (options.volcengine && !Object.keys(options.volcengine).length) delete options.volcengine;
  let prompt = renumberPrompt(input.prompt, refs);
  // Connecting an image can insert its tag on its own. That isn't a decomposition instruction.
  if (decompose && /^图\d+$/.test(prompt)) prompt = '';
  const references = refs.map((ref, i) =>
    connectedRef(cap, input.model, ref, 'reference', 'image', i + 1, input.allCards ?? [], provider)
  );
  checkCounts(cap, input.model, references);
  const parameters = effectiveParams(cap, input.capParams);
  if (parameters.size !== undefined || decompose) {
    delete parameters.aspect_ratio;
    delete parameters.resolution;
  }
  checkImageRules(cap, parameters, references.length, decompose);
  const payload: CreateTaskPayload = {
    provider,
    model: input.model,
    task_type: 'image_generation',
    task_mode: 'single',
    prompt: checkPrompt(cap, prompt, !decompose),
    params: compiledParams(parameters, options),
  };
  if (references.length) payload.reference_assets = references;
  return payload;
}

export function compileHeighlinerVideoPayload(card: SpatialCard, allCards: SpatialCard[] = []): CreateTaskPayload {
  const modelCap = requireCapability(card);
  const { mode, references: refs } = sentVideoSettings(card);
  if (!capVideoModes(modelCap).includes(mode)) throw new Error(`${card.model} 不支持「${MODE_LABELS[mode]}」模式`);
  // Editing a video follows the edit operation's declarations (its roles, sound option).
  const cap = modeCapability(modelCap, mode)!;

  const counters = { image: 0, video: 0, audio: 0 };
  const kling4 = isKling4(modelCap);
  let hasSource = false;
  const lastImage = refs.length - 1; // In frame mode sentVideoSettings keeps only images.
  const references = refs.map((ref, index) => {
    const type: RefMedia = ref.role === 'reference_audio' ? 'audio' : ref.role === 'reference_video' ? 'video' : 'image';
    let role = type === 'audio' ? 'voice' : mode === 'first_last_frame' ? ref.role : mode === 'video_edit' && type === 'video' ? EDIT_SOURCE_ROLE : 'reference';
    if (mode === 'motion_control') role = type === 'video' ? 'motion' : 'character';
    if (kling4) {
      if (type === 'image') role = ref.view ?? (mode === 'first_last_frame' && index !== 0 && index !== lastImage ? 'middle_frame' : role);
      if (type === 'video' && mode === 'video_edit') role = ref.view ?? (hasSource ? 'reference' : 'source');
      if (role === 'source') hasSource = true;
    }
    const compiled = connectedRef(cap, card.model, ref, role, type, ++counters[type], allCards, card.provider!);
    if (kling4) compiled.reference_id = `${type === 'video' ? 'video' : 'image'}_${counters[type]}`;
    return compiled;
  });
  if (mode === 'video_edit' && references.filter((r) => r.role === EDIT_SOURCE_ROLE).length !== 1) {
    throw new Error('视频编辑需要连入 1 段要编辑的视频');
  }

  if (mode === 'motion_control' && (counters.image !== 1 || counters.video !== 1)) {
    throw new Error('动作控制需要恰好 1 张人物图和 1 段动作视频');
  }
  if (kling4) {
    const images = references.filter((ref) => ref.type === 'image');
    if (mode === 'first_last_frame') {
      if (!images.length || images.some(ref => !['first_frame', 'middle_frame', 'last_frame'].includes(ref.role))) throw new Error('图生视频需要至少一张关键帧');
      if (modelCap.id === 'kling-4.0-flash' && (images.length !== 1 || images[0].role !== 'first_frame')) throw new Error('Flash 图生视频只允许一张首帧');
    }
    if (images.length > 10 || counters.video > 5 || references.length > 15) throw new Error('可灵 4.0 最多 10 张图片、5 段视频、共 15 项');
    if (images.some((ref, i) => (ref.role === 'first_frame' && i !== 0) || (ref.role === 'last_frame' && i !== images.length - 1))) {
      throw new Error('首帧需在图片序列最前、尾帧在最后；请按顺序连接或调整角色');
    }
  }

  // Asset-library items (multi-reference mode) go by asset ID, numbered after the connected cards of their kind.
  for (const asset of mode === 'all_modal' ? card.assetRefs ?? [] : []) {
    const { role, type } = ASSET_SLOT[asset.kind];
    if (!referenceSlot(cap, role, type)?.supports_asset) {
      throw new Error(`${card.model} 的${SLOT_LABELS[`${role}|${type}`]}不支持素材 ID，请移除素材「${asset.assetId}」`);
    }
    counters[asset.kind]++;
    references.push({
      card_id: '',
      tag_index: counters[asset.kind],
      role,
      type,
      label: asset.assetId,
      url: `asset://${asset.assetId}`,
    });
  }
  checkCounts(cap, card.model, references);

  const imageTag = isKlingOmni(modelCap) && (mode === 'all_modal' || mode === 'video_edit') ? klingImageTag : undefined;
  let prompt = mode === 'text_to_video' ? card.prompt.replace(/@?(图|视频|音频)\d+\s*/g, '').trim() : renumberPrompt(card.prompt, refs, imageTag);
  if (kling4 && mode !== 'text_to_video') {
    const tags = new Map(refs.map((ref, i) => [`${refNoun(ref.role)}${ref.tagIndex}`, references[i].reference_id]));
    prompt = card.prompt.replace(/@(图|视频|音频)(\d+)\b/g, (raw, noun, index) => {
      const id = tags.get(`${noun}${index}`);
      return id ? `@${id}` : raw;
    }).trim();
  }
  if (!prompt && references.length === 0) throw new Error('请先填写提示词');
  // An edit is told what to change; mentions of its media alone say nothing.
  if (mode === 'video_edit' && !prompt.replace(/<<<image_\d+>>>|图\d+|视频\d+|@(?:image|video)_\d+/g, '').trim()) {
    throw new Error('视频编辑需要提示词，说明要怎么改');
  }

  const parameters = sentParams(cap, card);
  if (mode === 'video_edit') {
    // The docs' edit request names the operation, prompt, references and resolution; the
    // output shape and length otherwise follow the gateway's edit defaults. Only what the
    // card set on purpose goes beyond that, so a default is never what the gateway rejects.
    for (const name of Object.keys(parameters)) {
      if (name !== 'resolution' && card.capParams?.[name] === undefined) delete parameters[name];
    }
    parameters.operation = EDIT_OPERATION;
  }
  // First/last frame: the frame sets the shape; send "adaptive" where the model has it, else no ratio.
  if (mode === 'first_last_frame') {
    if (kling4) delete parameters.aspect_ratio;
    else if (cap.parameters?.aspect_ratio?.enum?.includes('adaptive')) parameters.aspect_ratio = 'adaptive';
    else delete parameters.aspect_ratio;
  }
  const options = sentOptions(cap, card);
  const op = card.capOptions?.volcengine?.omni_reference_task_type;
  if (isSeedance25(card.model) && op !== undefined && options.volcengine?.omni_reference_task_type !== op) {
    throw new Error('模型目录未声明此编辑或延长操作，请刷新目录或取消选项');
  }
  // Ordinary Kling sound has two equivalent wire representations. Do not emit the
  // opposite implicit default alongside the user's choice.
  if (['kling-3.0', 'kling-3.0-omni'].includes(card.model) && !['video_edit', 'motion_control'].includes(mode) && options.kling) {
    const audio = card.capOptions?.kling?.audio;
    if (audio === undefined) delete options.kling.audio;
    else if (card.capParams?.generate_audio === undefined) delete parameters.generate_audio;
    else if (audio !== (parameters.generate_audio ? 'native' : 'off')) throw new Error('两个声音设置不一致：请只选择一种或保持一致');
    if (card.model === 'kling-3.0-omni' && counters.video && audio === 'native') throw new Error('带参考视频时不能生成音频');
  }
  if (mode === 'motion_control') {
    parameters.operation = MOTION_OPERATION;
    delete parameters.aspect_ratio;
    delete parameters.duration;
    delete parameters.generate_audio;
    if (!options.kling?.character_orientation) throw new Error('请选择动作控制的人物朝向');
  } else if (options.kling) delete options.kling.character_orientation;
  if (kling4 && options.kling) {
    if (mode === 'first_last_frame' || mode === 'text_to_video') delete options.kling.audio;
    if (options.kling.audio === 'original' && !counters.video) throw new Error('保留原声需要输入一段视频');
  }
  if (kling4 && mode === 'all_modal' && !references.length && (options.kling?.audio || parameters.aspect_ratio === 'adaptive')) {
    throw new Error('这些参考选项需要输入素材，请添加引用或取消声音／自适应比例');
  }
  if (mode === 'video_edit') {
    // Likewise vendor options: only the ones chosen (kling.audio omitted is off).
    for (const [ns, values] of Object.entries(options)) {
      for (const name of Object.keys(values)) {
        if (card.capOptions?.[ns]?.[name] === undefined) delete values[name];
      }
      if (Object.keys(values).length === 0) delete options[ns];
    }
  }
  applyVideoRules(cap, {
    mode,
    audioRefs: counters.audio,
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
    prompt: kling4 ? checkKling4Prompt(prompt) : checkPrompt(cap, prompt, isSeedance25(card.model) && references.length > 0 ? false : isMiniMaxH3(cap) || cap.parameters?.prompt?.required),
    params: compiledParams(parameters, options),
  };
  if (references.length) payload.reference_assets = references;
  return payload;
}

function checkKling4Prompt(prompt: string): string {
  if (!prompt) throw new Error('请先填写提示词');
  let ascii = 0;
  let nonAscii = 0;
  for (const c of prompt) c.codePointAt(0)! < 128 ? ascii++ : nonAscii++;
  if (ascii / 26000 + nonAscii / 11000 > 1) throw new Error('提示词超过可灵 4.0 的长度限制');
  return prompt;
}

/**
 * 生成正式视频: renders the full video from the finished sample on result card `source`. The
 * gateway inherits prompt, references, duration, ratio, seed and audio from the sample and
 * refuses them sent again, so only the resolution (explicit, 1080p) goes along with the sample's
 * task; the backend adds the gateway task ID after checking the sample offered this action.
 */
export function compileFinalizePayload(source: SpatialCard, action: ResultActionDto): CreateTaskPayload {
  if (!source.taskId || source.status !== 'succeeded') throw new Error(`「${source.title}」还没有可以操作的生成结果`);
  const resolution = finalResolution(action.id);
  if (!resolution || !supportsSample(source)) throw new Error('这个结果不支持该样片操作');
  return {
    provider: source.provider!,
    model: source.model,
    task_type: 'video_generation',
    task_mode: 'action',
    // Only recorded; the gateway takes the prompt from the sample.
    prompt: source.prompt.trim() || action.label || '生成正式视频',
    params: { parameters: { resolution }, source_task_id: source.taskId, action_id: action.id },
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
  const references = refs.map((ref, i) => connectedRef(cap, card.model, ref, roles[i], 'image', i + 1, allCards, card.provider!));
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
