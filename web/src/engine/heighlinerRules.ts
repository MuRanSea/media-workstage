import type { CapabilityDescriptor } from '../services/api.ts';
import type { CapOptions, CapValues } from '../types/canvas.ts';

/**
 * Rules the Heighliner docs state that a model's capability descriptor cannot express:
 * combinations of fields, inputs that exclude each other, and values a model lists but
 * rejects. The compiler applies them so a card sends what the gateway accepts, or says
 * plainly what to change, instead of a 400 after submission.
 */

/** Every media prompt is at most 32,000 bytes (UTF-8); a model may allow less. */
export const PROMPT_MAX_BYTES = 32000;

/** 3D prompts are at most 1024 characters on every model. */
export const PROMPT_MAX_CHARS_3D = 1024;

/** Seedream takes at most 15 images in all: the ones it makes plus the reference images. */
export const SEEDREAM_MAX_IMAGES = 15;

const tencentOptions = (cap: CapabilityDescriptor) => cap.provider_options_schema?.properties?.tencent?.properties ?? {};
const hasRefSlot = (cap: CapabilityDescriptor, role: string, type: string) =>
  (cap.references ?? []).some((r) => r.role === role && (r.types ?? []).includes(type));

export const isSeedream = (cap: CapabilityDescriptor) => cap.type === 'image' && /seedream/i.test(cap.id);
/** Kling's family takes `provider_options.kling`; only Omni takes reference images and a reference video. */
export const isKling = (cap: CapabilityDescriptor) => !!cap.provider_options_schema?.properties?.kling || /^kling/i.test(cap.id);
export const isKlingOmni = (cap: CapabilityDescriptor) => isKling(cap) && hasRefSlot(cap, 'reference', 'video');
export const isMiniMaxH3 = (cap: CapabilityDescriptor) => !!cap.provider_options_schema?.properties?.minimax || /minimax/i.test(cap.id);
/** Hunyuan 3D (hy-3d-3.0 / 3.1 / express) as against Tripo (tripo-3d-3.1 / p1). */
export const isTripo = (cap: CapabilityDescriptor) => cap.type === '3d' && (/^tripo/i.test(cap.id) || 'face_limit' in tencentOptions(cap));
export const isHunyuan3D = (cap: CapabilityDescriptor) => cap.type === '3d' && !isTripo(cap);

/**
 * The descriptor with what the docs add: Seedream 4.5 and 4.0 list 3K but reject it, and
 * every 3D prompt is capped at 1024 characters. Applied once, when descriptors are loaded.
 */
export function documentedCapability(cap: CapabilityDescriptor): CapabilityDescriptor {
  const params = cap.parameters;
  if (!params) return cap;
  let next = params;
  const resolution = params.resolution;
  if (/seedream-4-[05]/i.test(cap.id) && resolution?.enum?.includes('3K')) {
    const allowed = resolution.enum.filter((v) => v !== '3K');
    next = { ...next, resolution: { ...resolution, enum: allowed, default: resolution.default === '3K' ? allowed[0] : resolution.default } };
  }
  const prompt = params.prompt;
  if (cap.type === '3d' && prompt && !(prompt.maxLength !== undefined && prompt.maxLength <= PROMPT_MAX_CHARS_3D)) {
    next = { ...next, prompt: { ...prompt, maxLength: PROMPT_MAX_CHARS_3D } };
  }
  return next === params ? cap : { ...cap, parameters: next };
}

/** The prompt's size in UTF-8 bytes, which is what the gateway counts. */
export function promptBytes(prompt: string): number {
  return new TextEncoder().encode(prompt).length;
}

// --- Images ----------------------------------------------------------------------

/** Seedream's n plus its reference images may not pass 15. */
export function checkImageRules(cap: CapabilityDescriptor, params: CapValues, referenceCount: number): void {
  if (!isSeedream(cap)) return;
  const n = typeof params.n === 'number' ? params.n : 1;
  if (n + referenceCount > SEEDREAM_MAX_IMAGES) {
    throw new Error(`${cap.id} 的张数加参考图最多 ${SEEDREAM_MAX_IMAGES} 张，当前 ${n} 张 + ${referenceCount} 张参考图`);
  }
}

// --- Videos ----------------------------------------------------------------------

/** Kling Omni with a reference video takes at most four reference images. */
export const KLING_OMNI_IMAGES_WITH_VIDEO = 4;

export interface VideoRuleInput {
  mode: 'all_modal' | 'first_last_frame' | 'text_to_video';
  imageRefs: number;
  videoRefs: number;
  parameters: CapValues;
  options: CapOptions;
}

/**
 * Fits a video request to its model's rules, in place:
 * - Kling: `multi_shot` is true exactly when Omni has a reference video (the card does not
 *   offer it); Omni with a reference video takes at most four images and no generated audio.
 * - MiniMax H3: text-to-video cannot use `adaptive`, so the ratio is left to the model.
 */
export function applyVideoRules(cap: CapabilityDescriptor, input: VideoRuleInput): void {
  const { parameters, options } = input;
  if (isKling(cap)) {
    const kling = { ...options.kling };
    delete kling.multi_shot;
    if (isKlingOmni(cap) && input.videoRefs > 0) {
      if (input.imageRefs > KLING_OMNI_IMAGES_WITH_VIDEO) {
        throw new Error(`${cap.id} 带参考视频时最多 ${KLING_OMNI_IMAGES_WITH_VIDEO} 张参考图，当前 ${input.imageRefs} 张`);
      }
      if (parameters.generate_audio === true) throw new Error(`${cap.id} 带参考视频时不能生成音频，请关闭「生成音频」`);
      if (cap.provider_options_schema?.properties?.kling?.properties?.multi_shot) kling.multi_shot = true;
    }
    if (Object.keys(kling).length) options.kling = kling;
    else delete options.kling;
  }
  if (isMiniMaxH3(cap) && input.mode === 'text_to_video' && parameters.aspect_ratio === 'adaptive') {
    delete parameters.aspect_ratio;
  }
}

// --- 3D --------------------------------------------------------------------------

const MAIN_VIEWS = ['reference', 'multi_view_front'];

/** `tripo-3d-3.1`'s face_limit range for its geometry options (the descriptor gives the widest). */
export function tripoFaceLimitRange(tencent: CapValues): [number, number] {
  if (tencent.smart_low_poly === true) return tencent.quad === true ? [500, 10000] : [500, 20000];
  if (tencent.quad === true) return [1, 150000];
  if (tencent.geometry_quality === 'detailed') return [1, 2000000];
  return [1, 1500000];
}

/** Whether a 3D model sends the prompt along with images (only Hunyuan's Sketch mode does). */
export function promptGoesWithImages(cap: CapabilityDescriptor, options: CapOptions | undefined): boolean {
  if (isTripo(cap)) return false;
  return options?.tencent?.generate_type === 'Sketch';
}

export interface ThreeDRuleInput {
  prompt: string;
  /** Gateway roles of the connected images, in send order. */
  roles: string[];
  parameters: CapValues;
  options: CapOptions;
}

/**
 * Fits a 3D request to its model's rules. Returns the prompt to send and the roles to send
 * the images as; parameters and options are fitted in place.
 *
 * Hunyuan: the prompt and images exclude each other except in Sketch mode, which needs
 * both; multi-view needs one main image (主图 or 正面, not both); LowPoly ignores
 * face_count; Express white models (enable_geometry) cannot be OBJ.
 *
 * Tripo: the prompt only counts without images, so it is left out with them; multi-view
 * takes front/back/left/right and no separate main image, so a 主图 among other views goes
 * as the front; generate_parts needs texture, pbr and quad off; face_limit's range depends
 * on the geometry options.
 */
export function apply3DRules(cap: CapabilityDescriptor, input: ThreeDRuleInput): { prompt: string; roles: string[] } {
  let { prompt } = input;
  let roles = [...input.roles];
  const tencent: CapValues = { ...input.options.tencent };

  if (isHunyuan3D(cap)) {
    const mains = roles.filter((r) => MAIN_VIEWS.includes(r));
    if (mains.length > 1) throw new Error(`${cap.id} 只能有一张主图：「主图」和「正面」请只保留一张`);
    if (roles.length > 1 && mains.length === 0) throw new Error(`${cap.id} 多视图需要一张主图（主图或正面视角）`);
    if (tencent.generate_type === 'Sketch') {
      if (!prompt || mains.length === 0) throw new Error(`${cap.id} 的草图（Sketch）模式需要同时提供提示词和主图`);
    }
    if (tencent.generate_type === 'LowPoly') delete tencent.face_count;
    if (tencent.enable_geometry === true && input.parameters.output_format === 'obj') {
      throw new Error(`${cap.id} 只要白模时不能输出 OBJ，请换 GLB、STL 等格式`);
    }
  }

  if (roles.length > 0 && !promptGoesWithImages(cap, { tencent })) prompt = '';

  if (isTripo(cap)) {
    if (roles.length > 1 && roles.includes('reference')) {
      if (roles.includes('multi_view_front')) {
        throw new Error(`${cap.id} 多视图不单独要主图：请把「主图」改成背、左、右等视角，或去掉「正面」`);
      }
      roles = roles.map((r) => (r === 'reference' ? 'multi_view_front' : r));
    }
    if (tencent.generate_parts === true) {
      for (const name of ['texture', 'pbr', 'quad']) {
        if (name in tencentOptions(cap)) tencent[name] = false;
      }
    }
    const limit = tencent.face_limit;
    if (typeof limit === 'number' && 'smart_low_poly' in tencentOptions(cap)) {
      const [min, max] = tripoFaceLimitRange(tencent);
      if (limit < min || limit > max) throw new Error(`${cap.id} 在当前选项下面数上限须在 ${min}–${max} 之间，当前 ${limit}`);
    }
  }

  if (Object.keys(tencent).length) input.options.tencent = tencent;
  else delete input.options.tencent;
  return { prompt, roles };
}
