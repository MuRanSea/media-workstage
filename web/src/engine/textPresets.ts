import type { TextPreset } from '../types/canvas.ts';

export interface TextPresetDef {
  id: TextPreset;
  label: string;
  placeholder: string;
  /** System prompt sent with the card's text; empty for free chat. */
  system: string;
}

export const TEXT_PRESETS: TextPresetDef[] = [
  {
    id: 'image_prompt',
    label: '图片提示词',
    placeholder: '描述你想要的画面，例如：雨夜的赛博朋克街道，一个撑伞的少女',
    system:
      '你是专业的 AI 绘画提示词工程师。根据用户的想法，写一段可以直接用于文生图模型的中文提示词：' +
      '依次写清主体与动作、场景环境、构图与镜头、光线、色彩、艺术风格和画质细节，用逗号分隔的短语，' +
      '控制在 150 字以内。只输出提示词本身，不要标题、解释或引号。',
  },
  {
    id: 'video_prompt',
    label: '视频提示词',
    placeholder: '描述你想要的镜头，例如：少女在雨中转身，镜头缓慢推近',
    system:
      '你是专业的 AI 视频提示词工程师。根据用户的想法，写一段可以直接用于视频生成模型的中文提示词：' +
      '写清主体的动作与表情变化、镜头运动（推、拉、摇、移、跟、环绕）、节奏、场景氛围与光影变化，' +
      '用一段连贯的话，控制在 150 字以内。如果用户提到了 @图1 这类素材引用，原样保留。' +
      '只输出提示词本身，不要标题、解释或引号。',
  },
  {
    id: 'free',
    label: '自由对话',
    placeholder: '直接向模型提问或下指令',
    system: '',
  },
];

export function getTextPreset(id: TextPreset | undefined): TextPresetDef {
  return TEXT_PRESETS.find((p) => p.id === id) ?? TEXT_PRESETS[0];
}
