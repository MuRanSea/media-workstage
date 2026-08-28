import React, { useState, useRef } from 'react';
import {
  Sparkles, Video, Image as ImageIcon, Plus, MousePointer, Hand, Move,
  ZoomIn, ZoomOut, Film, Trash2, CheckCircle2, Loader2, AtSign, X, Layers,
  ChevronDown, ExternalLink, HelpCircle, ArrowRight, Volume2, VolumeX,
  Code, Sliders, Monitor, Smartphone, Square, Ratio, Maximize2, Split,
  LayoutGrid, ImagePlus
} from 'lucide-react';

export type VideoTaskMode = 'all_modal' | 'first_last_frame' | 'text_to_video';
export type ImageTaskMode = 'single' | 'layer_decomp' | 'sequential';

export interface ReferenceItem {
  cardId: string;
  tagIndex: number;
  role: 'reference_image' | 'first_frame' | 'last_frame';
  label: string;
}

export interface SpatialCard {
  id: string;
  type: 'image' | 'video';
  title: string;
  tagIndex: number;
  x: number;
  y: number;
  width: number;
  prompt: string;
  model: string;
  status: 'idle' | 'generating' | 'done';
  progress: number;
  // Video specific parameters
  mode?: VideoTaskMode;
  resolution?: string;
  duration?: number;
  ratio?: string;
  generateAudio?: boolean;
  outputFormat?: 'mp4' | 'mov';
  promptOptimizer?: boolean;
  references?: ReferenceItem[];
  // Image specific parameters (Seedream 5.0 series)
  imageMode?: ImageTaskMode;
  sizeMode?: 'tier' | 'custom_pixels';
  imageTier?: string; // 1K, 1.5K, 2K, 3K, 4K, auto
  imageRatioPreset?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3';
  customPixels?: string;
  imageFormat?: 'jpeg' | 'png';
  watermark?: boolean;
  background?: 'opaque' | 'transparent';
}

// Available Video Models
const VIDEO_MODELS = [
  {
    id: 'doubao-seedance-2-5-260628',
    name: 'Doubao Seedance 2.5',
    tag: '旗舰 30s 全模态',
    provider: 'ark',
    resolutions: ['480p', '720p', '1080p'],
    durations: [4, 5, 10, 15, 20, 30, -1],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    supportsAudio: true,
    supportsMov: true,
    maxRefs: 30
  },
  {
    id: 'doubao-seedance-2-0-260128',
    name: 'Doubao Seedance 2.0 Pro',
    tag: '4K 专业版',
    provider: 'ark',
    resolutions: ['480p', '720p', '1080p', '4k'],
    durations: [4, 5, 10, 15, -1],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    supportsAudio: true,
    supportsMov: false,
    maxRefs: 9
  },
  {
    id: 'MiniMax-H3',
    name: 'MiniMax H3',
    tag: '海螺 2K 高动态',
    provider: 'minimax',
    resolutions: ['720P', '1080P', '2K'],
    durations: [5, 6, 10, 15],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    supportsMov: false,
    maxRefs: 2
  },
  {
    id: 'video-01',
    name: 'MiniMax Video-01',
    tag: '海螺基础版',
    provider: 'minimax',
    resolutions: ['720P', '1080P'],
    durations: [6],
    ratios: ['16:9', '9:16'],
    supportsAudio: false,
    supportsMov: false,
    maxRefs: 1
  }
];

// Available Image Models (Seedream 5.0 Series per ark/6.1:81-190)
const IMAGE_MODELS = [
  {
    id: 'doubao-seedream-5-0-pro-260628',
    name: 'Doubao Seedream 5.0 Pro',
    tag: '2K/图层拆分/交互编辑',
    defaultTier: '2K',
    tiers: ['1K', '1.5K', '2K', 'auto'],
    pixelRangeText: '[92万, 462万像素]',
    defaultCustomPixel: '2048x1024',
    supportsLayerDecomp: true,
    supportsSequential: false
  },
  {
    id: 'doubao-seedream-5-0-lite-260128',
    name: 'Doubao Seedream 5.0 Lite',
    tag: '4K超清/连续组图分镜',
    defaultTier: '2K',
    tiers: ['2K', '3K', '4K'],
    pixelRangeText: '[368万, 1677万像素]',
    defaultCustomPixel: '2048x2048',
    supportsLayerDecomp: false,
    supportsSequential: true
  }
];

// Pixel mapping reference table directly transcribed from ark/6.1:103-184
const SEEDREAM_PIXEL_MAP: Record<string, Record<string, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '16:9': '1424x800',
    '9:16': '800x1424',
    '4:3': '1152x864',
    '3:4': '864x1152',
    '3:2': '1248x832',
    '2:3': '832x1248',
    '21:9': '1568x672'
  },
  '1.5K': {
    '1:1': '1536x1536',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '1792x1344',
    '3:4': '1344x1792',
    '3:2': '1872x1248',
    '2:3': '1248x1872',
    '21:9': '2352x1008'
  },
  '2K': {
    '1:1': '2048x2048',
    '16:9': '2816x1584',
    '9:16': '1584x2816',
    '4:3': '2368x1776',
    '3:4': '1776x2368',
    '3:2': '2496x1664',
    '2:3': '1664x2496',
    '21:9': '3136x1344'
  },
  '3K': {
    '1:1': '3072x3072',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3456x2592',
    '3:4': '2592x3456'
  },
  '4K': {
    '1:1': '4096x4096',
    '16:9': '4096x2304',
    '9:16': '2304x4096',
    '4:3': '4096x3072',
    '3:4': '3072x4096'
  }
};

export const VariantB_LovartSpatial: React.FC = () => {
  const [cards, setCards] = useState<SpatialCard[]>([
    {
      id: 'card-img-1',
      type: 'image',
      title: '赛博机甲少女设定',
      tagIndex: 1,
      x: 50,
      y: 120,
      width: 360,
      prompt: '特写肖像，银发机甲少女，深邃眼眸，精细金属质感外骨骼，Vogue 杂志风格光影',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'done',
      progress: 100,
      imageMode: 'single',
      sizeMode: 'tier',
      imageTier: '2K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false
    },
    {
      id: 'card-img-2',
      type: 'image',
      title: '未来雨夜街道场景',
      tagIndex: 2,
      x: 50,
      y: 530,
      width: 360,
      prompt: '赛博朋克都市雨夜全景，湿漉漉的沥青路面，红蓝霓虹灯招牌倒影，电影级景深',
      model: 'doubao-seedream-5-0-lite-260128',
      status: 'done',
      progress: 100,
      imageMode: 'single',
      sizeMode: 'tier',
      imageTier: '4K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false
    },
    {
      id: 'card-vid-1',
      type: 'video',
      title: 'Seedance 2.5 电影镜头生成',
      tagIndex: 3,
      x: 480,
      y: 120,
      width: 480,
      mode: 'all_modal',
      prompt: '以 @图1 为首帧与主角形象，置身于 @图2 的雨夜街道中。少女低头沉思随后抬眼望向镜头，摄影机缓慢推近特写，雨滴从发梢滑落，霓虹光晕在金属装甲表面流转',
      model: 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      resolution: '720p',
      duration: 5,
      ratio: '16:9',
      generateAudio: true,
      outputFormat: 'mp4',
      promptOptimizer: true,
      references: [
        { cardId: 'card-img-1', tagIndex: 1, role: 'reference_image', label: '机甲少女' },
        { cardId: 'card-img-2', tagIndex: 2, role: 'reference_image', label: '雨夜街道' }
      ]
    }
  ]);

  const [activeTool, setActiveTool] = useState<'select' | 'hand'>('select');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const startPanRef = useRef({ x: 0, y: 0 });

  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Custom UI Dropdown Open States
  const [openModelDropdownId, setOpenModelDropdownId] = useState<string | null>(null);
  const [mentionTargetCardId, setMentionTargetCardId] = useState<string | null>(null);
  const [showJsonInspectorCardId, setShowJsonInspectorCardId] = useState<string | null>(null);

  const handleMouseDownCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'hand' || e.button === 1 || e.target === e.currentTarget) {
      setIsPanning(true);
      startPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      setOpenModelDropdownId(null);
      setMentionTargetCardId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPanRef.current.x,
        y: e.clientY - startPanRef.current.y
      });
    } else if (draggingCardId) {
      const newX = (e.clientX - pan.x) / zoom - dragOffsetRef.current.x;
      const newY = (e.clientY - pan.y) / zoom - dragOffsetRef.current.y;
      setCards(prev => prev.map(c => c.id === draggingCardId ? { ...c, x: newX, y: newY } : c));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingCardId(null);
  };

  const handleStartDragCard = (e: React.MouseEvent<HTMLDivElement>, card: SpatialCard) => {
    if (activeTool === 'hand') return;
    e.stopPropagation();
    setDraggingCardId(card.id);
    dragOffsetRef.current = {
      x: (e.clientX - pan.x) / zoom - card.x,
      y: (e.clientY - pan.y) / zoom - card.y
    };
  };

  const triggerGenerate = (id: string) => {
    setCards(prev => prev.map(c => c.id === id ? { ...c, status: 'generating', progress: 10 } : c));
    const interval = setInterval(() => {
      setCards(prev => prev.map(c => {
        if (c.id === id) {
          if (c.progress >= 90) {
            clearInterval(interval);
            return { ...c, status: 'done', progress: 100 };
          }
          return { ...c, progress: c.progress + 20 };
        }
        return c;
      }));
    }, 500);
  };

  const selectVideoModel = (cardId: string, modelId: string) => {
    const modelDef = VIDEO_MODELS.find(m => m.id === modelId);
    setCards(prev => prev.map(c => {
      if (c.id !== cardId) return c;
      return {
        ...c,
        model: modelId,
        resolution: modelDef?.resolutions[0] ?? '720p',
        duration: modelDef?.durations[0] ?? 5,
        ratio: modelDef?.ratios[0] ?? '16:9'
      };
    }));
    setOpenModelDropdownId(null);
  };

  const selectImageModel = (cardId: string, modelId: string) => {
    const modelDef = IMAGE_MODELS.find(m => m.id === modelId);
    setCards(prev => prev.map(c => {
      if (c.id !== cardId) return c;
      return {
        ...c,
        model: modelId,
        imageTier: modelDef?.defaultTier ?? '2K',
        customPixels: modelDef?.defaultCustomPixel ?? '2048x2048',
        imageMode: 'single'
      };
    }));
    setOpenModelDropdownId(null);
  };

  const setTaskMode = (videoCardId: string, newMode: VideoTaskMode) => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      let newRefs = c.references ?? [];
      let newRatio = c.ratio;
      let newDuration = c.duration;

      if (newMode === 'text_to_video') {
        newRefs = [];
      } else if (newMode === 'first_last_frame') {
        newRefs = newRefs.slice(0, 2).map((r, idx) => ({
          ...r,
          role: idx === 0 ? 'first_frame' : 'last_frame'
        }));
        newRatio = 'adaptive';
      } else if (newMode === 'all_modal') {
        newRefs = newRefs.map(r => ({ ...r, role: 'reference_image' }));
      }
      return {
        ...c,
        mode: newMode,
        ratio: newRatio,
        duration: newDuration,
        references: newRefs
      };
    }));
  };

  const attachReference = (videoCardId: string, imageCard: SpatialCard) => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      const currentMode = c.mode ?? 'all_modal';
      if (currentMode === 'text_to_video') return c;

      const currentRefs = c.references ?? [];
      if (currentRefs.some(r => r.cardId === imageCard.id)) return c;
      if (currentMode === 'first_last_frame' && currentRefs.length >= 2) return c;

      const role: ReferenceItem['role'] = currentMode === 'first_last_frame'
        ? (currentRefs.length === 0 ? 'first_frame' : 'last_frame')
        : 'reference_image';

      const newRef: ReferenceItem = {
        cardId: imageCard.id,
        tagIndex: imageCard.tagIndex,
        role,
        label: imageCard.title.slice(0, 8)
      };

      const tagStr = `@图${imageCard.tagIndex}`;
      const newPrompt = c.prompt.includes(tagStr) ? c.prompt : `${c.prompt} ${tagStr}`;
      return {
        ...c,
        prompt: newPrompt,
        references: [...currentRefs, newRef]
      };
    }));
    setMentionTargetCardId(null);
  };

  const removeReference = (videoCardId: string, refCardId: string) => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      const targetRef = c.references?.find(r => r.cardId === refCardId);
      const newRefs = (c.references ?? []).filter(r => r.cardId !== refCardId);
      let newPrompt = c.prompt;
      if (targetRef) {
        newPrompt = newPrompt.replace(new RegExp(`@图${targetRef.tagIndex}\\b`, 'g'), '').trim();
      }
      return {
        ...c,
        prompt: newPrompt,
        references: newRefs
      };
    }));
  };

  const availableImageCards = cards.filter(c => c.type === 'image');

  // Compute compiled payload
  const getCompiledJsonPayload = (card: SpatialCard) => {
    if (card.type === 'video') {
      const isMiniMax = card.model.includes('MiniMax') || card.model.includes('video-01');
      if (isMiniMax) {
        return {
          model: card.model,
          prompt: card.prompt,
          first_frame_image: card.references?.[0] ? `data:image/jpeg;base64,...(Card ${card.references[0].tagIndex})` : undefined,
          last_frame_image: card.references?.[1] ? `data:image/jpeg;base64,...(Card ${card.references[1].tagIndex})` : undefined,
          duration: card.duration,
          resolution: card.resolution,
          prompt_optimizer: card.promptOptimizer
        };
      } else {
        const contentItems: any[] = [
          { type: 'text', text: card.prompt.replace(/@图/g, '图') }
        ];
        card.references?.forEach(r => {
          contentItems.push({
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,...(Card ${r.tagIndex})` },
            role: r.role
          });
        });
        return {
          model: card.model,
          content: contentItems,
          resolution: card.resolution,
          ratio: card.ratio,
          duration: card.duration,
          generate_audio: card.generateAudio,
          output_format: card.outputFormat
        };
      }
    }
    // Image Payload (Ark Seedream 5.0 Series)
    const isLayerDecomp = card.imageMode === 'layer_decomp';
    const isSequential = card.imageMode === 'sequential';
    const finalSize = card.sizeMode === 'custom_pixels'
      ? (card.customPixels || '2048x1024')
      : (card.imageTier ?? '2K');

    return {
      model: card.model,
      prompt: card.prompt,
      size: isLayerDecomp ? 'auto' : finalSize,
      response_format: 'url',
      output_format: card.imageFormat,
      watermark: card.watermark,
      layer_decomposition: isLayerDecomp,
      sequential_image_generation: isSequential ? 'auto' : 'disabled'
    };
  };

  const addNewCard = (type: 'image' | 'video') => {
    const nextIndex = cards.length + 1;
    const newCard: SpatialCard = {
      id: `card-${Date.now()}`,
      type,
      title: type === 'image' ? `新建原画图 ${nextIndex}` : `新建视频镜头 ${nextIndex}`,
      tagIndex: nextIndex,
      x: 180 - pan.x,
      y: 180 - pan.y,
      width: type === 'video' ? 480 : 360,
      prompt: type === 'image' ? '输入生图描述...' : '输入运镜指令，可通过 @图1 @图2 指代首帧或主体...',
      model: type === 'image' ? 'doubao-seedream-5-0-pro-260628' : 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      mode: 'all_modal',
      resolution: '720p',
      duration: 5,
      ratio: '16:9',
      generateAudio: true,
      outputFormat: 'mp4',
      promptOptimizer: true,
      imageMode: 'single',
      sizeMode: 'tier',
      imageTier: '2K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false,
      references: []
    };
    setCards(prev => [...prev, newCard]);
  };

  return (
    <div
      className="w-full h-full relative bg-[#0b0d14] overflow-hidden select-none cursor-default font-sans"
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Banner & Mode Info */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3 bg-[#141722]/95 backdrop-blur-md border border-slate-700/60 rounded-2xl px-4 py-2.5 shadow-2xl">
        <div className="p-1.5 rounded-xl bg-indigo-500/20 text-indigo-400">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-xs">Lovart 媒体工作台 • Seedream 5.0 & Seedance 2.5 原生控制台</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-medium font-mono">
              Seedream 5.0 Pro & Lite
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            生图支持 5.0 Pro (1K/1.5K/2K + 图层拆分) 与 5.0 Lite (2K/3K/4K + 连续组图) • 独立模型动态参数矩阵
          </p>
        </div>
      </div>

      {/* Floating Toolbar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-[#141722]/95 backdrop-blur-md border border-slate-700/60 rounded-2xl p-1.5 shadow-2xl text-slate-200">
        <button
          onClick={() => setActiveTool('select')}
          className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition ${activeTool === 'select' ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30' : 'hover:bg-slate-800 text-slate-400'}`}
        >
          <MousePointer className="w-3.5 h-3.5" /> 选择/拖拽
        </button>
        <button
          onClick={() => setActiveTool('hand')}
          className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition ${activeTool === 'hand' ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30' : 'hover:bg-slate-800 text-slate-400'}`}
        >
          <Hand className="w-3.5 h-3.5" /> 画布漫游
        </button>
        <div className="w-[1px] h-5 bg-slate-700 mx-1" />
        <button
          onClick={() => addNewCard('image')}
          className="px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 font-medium border border-pink-500/30 transition"
        >
          <Plus className="w-3.5 h-3.5" /> +生图卡片
        </button>
        <button
          onClick={() => addNewCard('video')}
          className="px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 font-medium border border-indigo-500/30 transition"
        >
          <Plus className="w-3.5 h-3.5" /> +视频卡片
        </button>
      </div>

      {/* Zoom Control Pill */}
      <div className="absolute bottom-20 right-6 z-20 flex flex-col gap-1 bg-[#141722]/90 backdrop-blur border border-slate-700/60 rounded-xl p-1 text-slate-300 shadow-xl">
        <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} className="p-2 hover:bg-slate-800 rounded-lg transition">
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="text-[10px] text-center font-mono py-0.5 text-slate-400">{Math.round(zoom * 100)}%</div>
        <button onClick={() => setZoom(z => Math.max(0.4, z - 0.15))} className="p-2 hover:bg-slate-800 rounded-lg transition">
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Infinite Canvas Viewport */}
      <div
        className="w-full h-full origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          backgroundImage: 'radial-gradient(circle, #232838 1.2px, transparent 1.2px)',
          backgroundSize: '28px 28px'
        }}
      >
        {/* SVG Multi-Ray Connection Lines */}
        <svg className="absolute top-0 left-0 w-[6000px] h-[6000px] pointer-events-none z-0">
          <defs>
            <linearGradient id="rayGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ec4899" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.8" />
            </linearGradient>
          </defs>
          {cards.filter(c => c.type === 'video').map(videoCard => {
            return (videoCard.references ?? []).map(ref => {
              const srcCard = cards.find(c => c.id === ref.cardId);
              if (!srcCard) return null;

              const startX = srcCard.x + srcCard.width;
              const startY = srcCard.y + 110;
              const endX = videoCard.x;
              const endY = videoCard.y + 160;
              const dx = (endX - startX) * 0.45;

              const midX = (startX + endX) / 2;
              const midY = (startY + endY) / 2;

              return (
                <g key={`ray-${srcCard.id}-${videoCard.id}`}>
                  <path
                    d={`M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke="url(#rayGradient)"
                    strokeWidth="2.5"
                    strokeDasharray="6 4"
                  />
                  <g transform={`translate(${midX - 26}, ${midY - 10})`}>
                    <rect width="52" height="20" rx="10" fill="#141722" stroke="#6366f1" strokeWidth="1.5" />
                    <text x="26" y="14" fill="#a5b4fc" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
                      @图{ref.tagIndex}
                    </text>
                  </g>
                </g>
              );
            });
          })}
        </svg>

        {/* Spatial Cards */}
        {cards.map(card => {
          const currentVideoModelDef = VIDEO_MODELS.find(m => m.id === card.model) ?? VIDEO_MODELS[0];
          const currentImageModelDef = IMAGE_MODELS.find(m => m.id === card.model) ?? IMAGE_MODELS[0];

          // Compute mapped pixel info for Seedream
          const currentTier = card.imageTier ?? currentImageModelDef.defaultTier;
          const currentRatio = card.imageRatioPreset ?? '16:9';
          const mappedPixels = SEEDREAM_PIXEL_MAP[currentTier]?.[currentRatio] ?? '由模型自动判断';

          return (
            <div
              key={card.id}
              style={{
                transform: `translate(${card.x}px, ${card.y}px)`,
                width: `${card.width}px`
              }}
              className={`absolute z-10 bg-[#141722]/98 border rounded-2xl shadow-2xl overflow-visible text-slate-200 transition-shadow ${
                draggingCardId === card.id ? 'border-indigo-500 ring-4 ring-indigo-500/20 shadow-indigo-500/30 scale-[1.01]' : 'border-slate-700/80 hover:border-slate-600'
              }`}
            >
              {/* Card Header */}
              <div
                onMouseDown={e => handleStartDragCard(e, card)}
                className="bg-slate-800/90 px-4 py-2.5 border-b border-slate-700/80 rounded-t-2xl flex items-center justify-between cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center gap-2">
                  <Move className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-bold text-white tracking-wide">{card.title}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowJsonInspectorCardId(showJsonInspectorCardId === card.id ? null : card.id)}
                    className="p-1 rounded hover:bg-slate-700/60 text-slate-400 hover:text-indigo-300 transition"
                    title="查看真实提交的 API Payload"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>

                  <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    card.type === 'image'
                      ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  }`}>
                    @图{card.tagIndex}
                  </span>
                </div>
              </div>

              {/* API JSON Payload Inspector Drawer */}
              {showJsonInspectorCardId === card.id && (
                <div className="bg-[#090b10] p-3 border-b border-slate-800 text-[10px] font-mono text-emerald-400 max-h-48 overflow-y-auto space-y-1">
                  <div className="flex justify-between text-slate-400 border-b border-slate-800 pb-1">
                    <span>📡 API 真实请求 Payload (包含 Size/Prompt 序列化)</span>
                    <button type="button" onClick={() => setShowJsonInspectorCardId(null)} className="hover:text-white">✕</button>
                  </div>
                  <pre className="whitespace-pre-wrap">{JSON.stringify(getCompiledJsonPayload(card), null, 2)}</pre>
                </div>
              )}

              {/* Card Body */}
              <div className="p-4 space-y-3.5">
                {/* ========================================================================= */}
                {/* 1. IMAGE CARD BODY (SEEDREAM 5.0 SERIES / ARK 6.1:81-190 SPEC)            */}
                {/* ========================================================================= */}
                {card.type === 'image' && (
                  <>
                    {/* Image Model Custom Dark Dropdown */}
                    <div className="relative">
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">生图模型引擎 (Seedream 5.0 系列)</label>
                      <button
                        type="button"
                        onClick={() => setOpenModelDropdownId(openModelDropdownId === card.id ? null : card.id)}
                        className="w-full flex items-center justify-between bg-[#0e1017] hover:bg-[#12151f] border border-slate-700/90 rounded-xl px-3 py-2 text-xs text-white transition focus:outline-none focus:border-pink-500"
                      >
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-4 h-4 text-pink-400" />
                          <span className="font-semibold">{currentImageModelDef.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 font-medium">
                            {currentImageModelDef.tag}
                          </span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      </button>

                      {/* Custom Dark Dropdown Popover */}
                      {openModelDropdownId === card.id && (
                        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#171a26] border border-slate-700 rounded-xl p-1.5 shadow-2xl z-30 space-y-1 animate-in fade-in">
                          {IMAGE_MODELS.map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => selectImageModel(card.id, m.id)}
                              className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs transition ${
                                card.model === m.id ? 'bg-pink-600 text-white font-bold' : 'hover:bg-slate-800 text-slate-200'
                              }`}
                            >
                              <div>
                                <span>{m.name}</span>
                                <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded bg-slate-800 text-pink-300">
                                  {m.tiers.join('/')}
                                </span>
                              </div>
                              <span className="text-[10px] opacity-80">{m.tag}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Image Task Mode Switcher (Model Gated) */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">生图模式 (Task Mode)</label>
                      <div className="grid grid-cols-3 gap-1 bg-[#0e1017] p-1 rounded-xl border border-slate-800 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageMode: 'single' } : c))}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            card.imageMode === 'single' || !card.imageMode ? 'bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          单图生成
                        </button>
                        <button
                          type="button"
                          disabled={!currentImageModelDef.supportsLayerDecomp}
                          onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageMode: 'layer_decomp' } : c))}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            !currentImageModelDef.supportsLayerDecomp
                              ? 'opacity-30 cursor-not-allowed text-slate-500'
                              : card.imageMode === 'layer_decomp'
                              ? 'bg-pink-600 text-white shadow-md'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                          title={currentImageModelDef.supportsLayerDecomp ? '拆解为1张底图+最多16个图层' : '仅 5.0 Pro 支持图层拆分'}
                        >
                          图层拆分 (Pro)
                        </button>
                        <button
                          type="button"
                          disabled={!currentImageModelDef.supportsSequential}
                          onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageMode: 'sequential' } : c))}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            !currentImageModelDef.supportsSequential
                              ? 'opacity-30 cursor-not-allowed text-slate-500'
                              : card.imageMode === 'sequential'
                              ? 'bg-pink-600 text-white shadow-md'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                          title={currentImageModelDef.supportsSequential ? '生成最多15张连贯分镜组图' : '仅 5.0 Lite 支持连续组图'}
                        >
                          连续组图 (Lite)
                        </button>
                      </div>
                    </div>

                    {/* Ark 6.1 Size Controls (Mutually Exclusive: 方式1 档位 vs 方式2 显式像素) */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-semibold text-slate-300">尺寸配置方式 (ark/6.1 规范)</label>
                        <span className="text-[10px] text-amber-400/80">方式1与方式2互斥</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1 bg-[#0e1017] p-1 rounded-xl border border-slate-800 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, sizeMode: 'tier' } : c))}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            card.sizeMode === 'tier' || !card.sizeMode ? 'bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          方式1: 档位预设 ({currentImageModelDef.tiers.join('/')})
                        </button>
                        <button
                          type="button"
                          onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, sizeMode: 'custom_pixels', customPixels: c.customPixels || currentImageModelDef.defaultCustomPixel } : c))}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            card.sizeMode === 'custom_pixels' ? 'bg-pink-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          方式2: 显式像素 (宽x高)
                        </button>
                      </div>
                    </div>

                    {/* Size Parameters Sub-panel */}
                    <div className="bg-[#0e1017] border border-slate-800 p-3 rounded-2xl space-y-2.5">
                      {/* Method 1: Tier Selection + Ratio Mapping */}
                      {(card.sizeMode === 'tier' || !card.sizeMode) ? (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 text-[11px] flex items-center gap-1">
                              <Monitor className="w-3.5 h-3.5 text-pink-400" /> 分辨率档位 (Size):
                            </span>
                            <div className="flex items-center gap-1">
                              {currentImageModelDef.tiers.map(tr => (
                                <button
                                  key={tr}
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageTier: tr } : c))}
                                  className={`px-2 py-0.5 rounded-lg font-mono text-[11px] font-bold transition ${
                                    currentTier === tr ? 'bg-pink-600 text-white shadow-md' : 'bg-[#181a24] text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  {tr}
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-400 text-[11px] flex items-center gap-1">
                                <Ratio className="w-3.5 h-3.5 text-pink-400" /> 常见宽高比与像素映射:
                              </span>
                              <span className="font-mono text-[11px] text-pink-300 font-bold">
                                {mappedPixels}
                              </span>
                            </div>

                            <div className="grid grid-cols-4 gap-1 text-[10px] font-mono">
                              {(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const).map(rt => (
                                <button
                                  key={rt}
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageRatioPreset: rt } : c))}
                                  className={`py-1 px-1 rounded-lg text-center font-semibold transition ${
                                    card.imageRatioPreset === rt
                                      ? 'bg-pink-600 text-white shadow-md'
                                      : 'bg-[#181a24] text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  {rt}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        /* Method 2: Explicit width x height pixels */
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-400 text-[11px]">显式宽高像素 (宽x高):</span>
                            <span className="font-mono text-[10px] text-slate-500">{currentImageModelDef.pixelRangeText}</span>
                          </div>
                          <input
                            type="text"
                            value={card.customPixels ?? currentImageModelDef.defaultCustomPixel}
                            onChange={e => {
                              const val = e.target.value;
                              setCards(prev => prev.map(c => c.id === card.id ? { ...c, customPixels: val } : c));
                            }}
                            className="w-full bg-[#181a24] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-pink-300 focus:outline-none focus:border-pink-500"
                            placeholder="例如 2048x1024, 2816x1584"
                          />
                        </div>
                      )}

                      {/* Format & Watermark */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-xs">
                        <button
                          type="button"
                          onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageFormat: c.imageFormat === 'png' ? 'jpeg' : 'png' } : c))}
                          className="text-[10px] font-mono font-semibold text-pink-300 bg-pink-500/10 px-2 py-0.5 rounded-md border border-pink-500/20"
                        >
                          格式: {card.imageFormat?.toUpperCase()}
                        </button>

                        <button
                          type="button"
                          onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, watermark: !c.watermark } : c))}
                          className={`text-[10px] px-2 py-0.5 rounded-md border transition ${
                            !card.watermark ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-800/40 text-slate-400 border-slate-700/50'
                          }`}
                        >
                          {!card.watermark ? '无水印' : '含水印'}
                        </button>
                      </div>
                    </div>

                    {/* Image Preview Canvas */}
                    <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-video flex items-center justify-center">
                      <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-purple-950 to-pink-950 flex flex-col items-center justify-center p-4 text-center">
                        <ImageIcon className="w-8 h-8 text-pink-400/80 mb-2" />
                        <span className="text-xs text-pink-200 font-semibold">{currentImageModelDef.name}</span>
                        <span className="text-[10px] text-slate-400 mt-1">
                          {card.sizeMode === 'custom_pixels' ? card.customPixels : `${currentTier} • ${mappedPixels}`}
                        </span>
                      </div>
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] font-mono font-bold text-pink-300 border border-pink-500/30">
                        @图{card.tagIndex}
                      </div>
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> 就绪
                      </div>
                    </div>

                    {/* Prompt Textarea */}
                    <div>
                      <label className="text-[11px] font-medium text-slate-400 block mb-1">生图提示词 (Prompt)</label>
                      <textarea
                        value={card.prompt}
                        onChange={e => {
                          const val = e.target.value;
                          setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                        }}
                        className="w-full bg-[#0e1017] border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-pink-500 resize-none h-16 leading-relaxed"
                      />
                    </div>
                  </>
                )}

                {/* ========================================================================= */}
                {/* 2. VIDEO CARD BODY (SEEDANCE 2.5 / MINIMAX FULL PARAM MATRIX)             */}
                {/* ========================================================================= */}
                {card.type === 'video' && (
                  <>
                    {/* Model Custom Dark Dropdown */}
                    <div className="relative">
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">AI 视频模型引擎</label>
                      <button
                        type="button"
                        onClick={() => setOpenModelDropdownId(openModelDropdownId === card.id ? null : card.id)}
                        className="w-full flex items-center justify-between bg-[#0e1017] hover:bg-[#12151f] border border-slate-700/90 rounded-xl px-3 py-2 text-xs text-white transition focus:outline-none focus:border-indigo-500"
                      >
                        <div className="flex items-center gap-2">
                          <Film className="w-4 h-4 text-indigo-400" />
                          <span className="font-semibold">{currentVideoModelDef.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
                            {currentVideoModelDef.tag}
                          </span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      </button>

                      {/* Custom Dark Popover Menu */}
                      {openModelDropdownId === card.id && (
                        <div className="absolute top-full left-0 right-0 mt-1.5 bg-[#171a26] border border-slate-700 rounded-xl p-1.5 shadow-2xl z-30 space-y-1 animate-in fade-in">
                          {VIDEO_MODELS.map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => selectVideoModel(card.id, m.id)}
                              className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between text-xs transition ${
                                card.model === m.id ? 'bg-indigo-600 text-white font-bold' : 'hover:bg-slate-800 text-slate-200'
                              }`}
                            >
                              <div>
                                <span>{m.name}</span>
                                <span className={`text-[10px] ml-2 px-1.5 py-0.5 rounded ${card.model === m.id ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                  {m.provider === 'ark' ? '火山方舟' : 'MiniMax 原生'}
                                </span>
                              </div>
                              <span className="text-[10px] opacity-80">{m.tag}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Task Mode Switcher */}
                    <div>
                      <label className="text-[11px] font-semibold text-slate-300 block mb-1">生成场景模式</label>
                      <div className="grid grid-cols-3 gap-1 bg-[#0e1017] p-1 rounded-xl border border-slate-800 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setTaskMode(card.id, 'all_modal')}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            card.mode === 'all_modal' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          全模态多参考
                        </button>
                        <button
                          type="button"
                          onClick={() => setTaskMode(card.id, 'first_last_frame')}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            card.mode === 'first_last_frame' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          首尾帧严格模式
                        </button>
                        <button
                          type="button"
                          onClick={() => setTaskMode(card.id, 'text_to_video')}
                          className={`py-1.5 rounded-lg font-medium transition ${
                            card.mode === 'text_to_video' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          纯文生视频
                        </button>
                      </div>
                    </div>

                    {/* Interactive Parameter Control Matrix (Resolution / Duration / Ratio / Audio) */}
                    <div className="bg-[#0e1017] border border-slate-800 p-3 rounded-2xl space-y-2.5">
                      {/* Resolution Selector (Gated by selected model) */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 text-[11px] flex items-center gap-1">
                          <Monitor className="w-3.5 h-3.5 text-indigo-400" /> 分辨率 (Resolution):
                        </span>
                        <div className="flex items-center gap-1">
                          {currentVideoModelDef.resolutions.map(res => (
                            <button
                              key={res}
                              type="button"
                              onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, resolution: res } : c))}
                              className={`px-2 py-0.5 rounded-lg font-mono text-[11px] font-bold transition ${
                                card.resolution === res ? 'bg-indigo-600 text-white shadow-md' : 'bg-[#181a24] text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {res}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Duration Selector */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 text-[11px] flex items-center gap-1">
                          <Sliders className="w-3.5 h-3.5 text-indigo-400" /> 视频时长 (Duration):
                        </span>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {currentVideoModelDef.durations.map(dur => (
                            <button
                              key={dur}
                              type="button"
                              onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, duration: dur } : c))}
                              className={`px-2 py-0.5 rounded-lg font-mono text-[11px] font-bold transition ${
                                card.duration === dur ? 'bg-indigo-600 text-white shadow-md' : 'bg-[#181a24] text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {dur === -1 ? '自适应' : `${dur}s`}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Aspect Ratio Selector (Disabled/Adaptive when first_last_frame mode) */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400 text-[11px] flex items-center gap-1">
                          <Ratio className="w-3.5 h-3.5 text-indigo-400" /> 画面比例 (Ratio):
                        </span>
                        <div className="flex items-center gap-1 flex-wrap justify-end">
                          {card.mode === 'first_last_frame' ? (
                            <span className="px-2 py-0.5 rounded-lg bg-indigo-600/30 border border-indigo-500/40 text-[10px] font-mono text-indigo-300">
                              自适应首帧 (adaptive)
                            </span>
                          ) : (
                            currentVideoModelDef.ratios.map(rt => (
                              <button
                                key={rt}
                                type="button"
                                onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, ratio: rt } : c))}
                                className={`px-1.5 py-0.5 rounded-lg text-[10px] font-mono font-semibold transition ${
                                  card.ratio === rt ? 'bg-indigo-600 text-white shadow-md' : 'bg-[#181a24] text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {rt}
                              </button>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Audio & Format Toggles */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-xs">
                        {currentVideoModelDef.supportsAudio && (
                          <button
                            type="button"
                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, generateAudio: !c.generateAudio } : c))}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                              card.generateAudio ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-800/40 text-slate-400 border-slate-700/50'
                            }`}
                          >
                            {card.generateAudio ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                            {card.generateAudio ? '原生音频开启' : '关闭音频'}
                          </button>
                        )}

                        {currentVideoModelDef.supportsMov && (
                          <button
                            type="button"
                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, outputFormat: c.outputFormat === 'mp4' ? 'mov' : 'mp4' } : c))}
                            className="text-[11px] font-mono font-semibold text-indigo-300 bg-indigo-500/10 px-2 py-1 rounded-lg border border-indigo-500/20"
                          >
                            格式: {card.outputFormat?.toUpperCase()}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Multi-Image Reference Slots */}
                    {card.mode !== 'text_to_video' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-indigo-400" />
                            {card.mode === 'all_modal'
                              ? `全模态参考素材池 (${card.references?.length ?? 0}/${currentVideoModelDef.maxRefs})`
                              : `首尾帧素材 (${card.references?.length ?? 0}/2)`}
                          </span>
                          <button
                            type="button"
                            onClick={() => setMentionTargetCardId(mentionTargetCardId === card.id ? null : card.id)}
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20 transition"
                          >
                            <Plus className="w-3 h-3" /> 引入画布图片
                          </button>
                        </div>

                        {/* Reference items chips */}
                        <div className="space-y-1.5">
                          {card.references && card.references.length > 0 ? (
                            card.references.map((ref, idx) => (
                              <div
                                key={ref.cardId}
                                className="flex items-center justify-between bg-[#0e1017] border border-slate-800 p-2 rounded-xl text-xs gap-2"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30 flex-shrink-0">
                                    @图{ref.tagIndex}
                                  </span>
                                  <span className="text-slate-300 text-xs truncate max-w-[140px]">{ref.label}</span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-indigo-300">
                                    {card.mode === 'first_last_frame'
                                      ? (idx === 0 ? 'first_frame (首帧)' : 'last_frame (尾帧)')
                                      : 'reference_image'}
                                  </span>

                                  <button
                                    type="button"
                                    onClick={() => removeReference(card.id, ref.cardId)}
                                    className="text-slate-500 hover:text-red-400 p-1 transition"
                                    title="移除素材"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-2.5 rounded-xl border border-dashed border-slate-800 text-center text-[11px] text-slate-500">
                              暂无绑定素材，点击右上角引入
                            </div>
                          )}
                        </div>

                        {/* Mention Picker Dropdown */}
                        {mentionTargetCardId === card.id && (
                          <div className="bg-[#171a26] border border-indigo-500/40 rounded-xl p-2 shadow-2xl space-y-1 animate-in fade-in">
                            <span className="text-[10px] font-semibold text-slate-400 px-1 block">选择画布素材引入：</span>
                            {availableImageCards.map(img => (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => attachReference(card.id, img)}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-indigo-600/30 flex items-center justify-between text-xs transition"
                              >
                                <span className="flex items-center gap-2">
                                  <span className="font-mono font-bold text-pink-400">@图{img.tagIndex}</span>
                                  <span className="text-slate-200">{img.title}</span>
                                </span>
                                <span className="text-[10px] text-indigo-300 font-medium">+ 绑定并插入 @</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Prompt Textarea with @ Mentions */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                          <AtSign className="w-3 h-3 text-indigo-400" />
                          视频运镜指令 (Prompt)
                        </label>
                        {card.mode === 'all_modal' && (
                          <span className="text-[10px] text-amber-400/90 font-medium">
                            支持在 Prompt 中用 @图N 指定首尾帧与主体
                          </span>
                        )}
                      </div>

                      <textarea
                        value={card.prompt}
                        onChange={e => {
                          const val = e.target.value;
                          setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                        }}
                        className="w-full bg-[#0e1017] border border-slate-700/80 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-20 leading-relaxed font-sans"
                        placeholder="描述画面动作与运镜，输入 @图1 @图2 引用素材..."
                      />

                      {/* Quick Mention Insertion Chips */}
                      {card.mode === 'all_modal' && availableImageCards.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <span className="text-[10px] text-slate-500">快捷插入:</span>
                          {availableImageCards.map(img => (
                            <button
                              key={img.id}
                              type="button"
                              onClick={() => attachReference(card.id, img)}
                              className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-indigo-300 border border-slate-700 transition"
                            >
                              + @图{img.tagIndex} ({img.title.slice(0, 4)})
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Generation Status / Output Preview */}
                    {card.status === 'generating' && (
                      <div className="space-y-1 bg-[#0e1017] p-2.5 rounded-xl border border-slate-800">
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span className="flex items-center gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                            {currentVideoModelDef.provider === 'ark' ? '火山方舟' : 'MiniMax'} 异步渲染中...
                          </span>
                          <span className="font-mono">{card.progress}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-pink-500 via-indigo-500 to-cyan-400 transition-all duration-300" style={{ width: `${card.progress}%` }} />
                        </div>
                      </div>
                    )}

                    {card.status === 'done' ? (
                      <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-black aspect-video flex items-center justify-center">
                        <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-slate-900 to-cyan-950 flex flex-col items-center justify-center p-4">
                          <Film className="w-8 h-8 text-indigo-400 mb-2" />
                          <span className="text-xs text-indigo-200 font-semibold">生成视频: output_{card.model}.mp4</span>
                          <span className="text-[10px] text-slate-400 mt-1">
                            {card.resolution} • {card.duration}s • {card.ratio}
                          </span>
                        </div>
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> 渲染完成
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => triggerGenerate(card.id)}
                        disabled={card.status === 'generating'}
                        className="w-full py-2.5 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition active:scale-98"
                      >
                        <Sparkles className="w-4 h-4" /> 提交 {currentVideoModelDef.name} 视频生成
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
