import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles, Video, Image as ImageIcon, Plus, MousePointer, Hand, Move,
  ZoomIn, ZoomOut, Film, Trash2, CheckCircle2, Loader2, AtSign, X, Layers,
  ChevronDown, ChevronUp, ExternalLink, HelpCircle, ArrowRight, Volume2, VolumeX,
  Code, Sliders, Monitor, Smartphone, Square, Ratio, Maximize2, Split,
  LayoutGrid, ImagePlus, Compass, Focus, Settings2, Play, Hash
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
  // UI folding & tab state
  isExpanded?: boolean;
  activeParamTab?: 'specs' | 'refs' | 'advanced';
  // Video specific parameters
  mode?: VideoTaskMode;
  resolution?: string;
  duration?: number;
  ratio?: string;
  generateAudio?: boolean;
  outputFormat?: 'mp4' | 'mov';
  promptOptimizer?: boolean;
  seed?: number;
  references?: ReferenceItem[];
  // Image specific parameters (Seedream 5.0 Series)
  imageMode?: ImageTaskMode;
  sizeMode?: 'tier' | 'custom_pixels';
  imageTier?: string;
  imageRatioPreset?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9';
  customPixels?: string;
  imageFormat?: 'jpeg' | 'png';
  watermark?: boolean;
  background?: 'opaque' | 'transparent';
  seedImage?: number;
}

const VIDEO_MODELS = [
  {
    id: 'doubao-seedance-2-5-260628',
    name: 'Seedance 2.5',
    tag: '旗舰30s全模态',
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
    name: 'Seedance 2.0 Pro',
    tag: '4K专业版',
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
    tag: '海螺2K高动态',
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

const IMAGE_MODELS = [
  {
    id: 'doubao-seedream-5-0-pro-260628',
    name: 'Seedream 5.0 Pro',
    tag: '2K/图层拆分',
    defaultTier: '2K',
    tiers: ['1K', '1.5K', '2K'],
    minPixels: 921600,
    maxPixels: 4624220,
    pixelRangeText: '92万~462万px',
    defaultCustomPixel: '2048x1024',
    supportsLayerDecomp: true,
    supportsSequential: false
  },
  {
    id: 'doubao-seedream-5-0-lite-260128',
    name: 'Seedream 5.0 Lite',
    tag: '4K超清/连环组图',
    defaultTier: '2K',
    tiers: ['2K', '3K', '4K'],
    minPixels: 3686400,
    maxPixels: 16777216,
    pixelRangeText: '368万~1677万px',
    defaultCustomPixel: '2048x2048',
    supportsLayerDecomp: false,
    supportsSequential: true
  }
];

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
    '16:9': '4096x2304',
    '9:16': '2304x4096',
    '4:3': '3456x2592',
    '3:4': '2592x3456'
  },
  '4K': {
    '1:1': '4096x4096',
    '16:9': '5504x3040',
    '9:16': '3040x5504',
    '4:3': '4704x3520',
    '3:4': '3520x4704'
  }
};

export const VariantB_SpatialCanvas: React.FC = () => {
  const [cards, setCards] = useState<SpatialCard[]>([
    {
      id: 'card-img-1',
      type: 'image',
      title: '机甲少女设定',
      tagIndex: 1,
      x: 80,
      y: 140,
      width: 330,
      prompt: '特写肖像，银发机甲少女，深邃眼眸，精细金属质感外骨骼，Vogue 光影',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'done',
      progress: 100,
      isExpanded: false,
      activeParamTab: 'specs',
      imageMode: 'single',
      sizeMode: 'tier',
      imageTier: '2K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false,
      background: 'opaque'
    },
    {
      id: 'card-img-2',
      type: 'image',
      title: '雨夜街道场景',
      tagIndex: 2,
      x: 80,
      y: 520,
      width: 330,
      prompt: '赛博朋克都市雨夜全景，湿漉漉的沥青路面，红蓝霓虹灯招牌倒影，电影级景深',
      model: 'doubao-seedream-5-0-lite-260128',
      status: 'done',
      progress: 100,
      isExpanded: false,
      activeParamTab: 'specs',
      imageMode: 'single',
      sizeMode: 'tier',
      imageTier: '4K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false,
      background: 'opaque'
    },
    {
      id: 'card-vid-1',
      type: 'video',
      title: '电影镜头生成',
      tagIndex: 3,
      x: 470,
      y: 140,
      width: 460,
      mode: 'all_modal',
      isExpanded: false,
      activeParamTab: 'specs',
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

  const [transform, setTransform] = useState<{ zoom: number; panX: number; panY: number }>({
    zoom: 0.85,
    panX: 60,
    panY: 20
  });

  const [isPanning, setIsPanning] = useState(false);
  const startPanRef = useRef({ x: 0, y: 0 });
  const mousePosRef = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const [selectedCardId, setSelectedCardId] = useState<string | null>('card-vid-1');
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const [openDropdownCardId, setOpenDropdownCardId] = useState<string | null>(null);
  const [mentionPickerCardId, setMentionPickerCardId] = useState<string | null>(null);
  const [showJsonInspectorCardId, setShowJsonInspectorCardId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const zoomAtPoint = useCallback((
    zoomUpdater: number | ((currentZoom: number) => number),
    clientX?: number,
    clientY?: number
  ) => {
    setTransform(prev => {
      const rect = containerRef.current?.getBoundingClientRect();
      const sX = (clientX !== undefined ? clientX : mousePosRef.current.x) - (rect?.left ?? 0);
      const sY = (clientY !== undefined ? clientY : mousePosRef.current.y) - (rect?.top ?? 0);

      const targetZoom = typeof zoomUpdater === 'function' ? zoomUpdater(prev.zoom) : zoomUpdater;
      const nextZoom = Math.min(2.5, Math.max(0.25, targetZoom));

      if (nextZoom === prev.zoom) return prev;

      const worldX = (sX - prev.panX) / prev.zoom;
      const worldY = (sY - prev.panY) / prev.zoom;

      const nextPanX = sX - worldX * nextZoom;
      const nextPanY = sY - worldY * nextZoom;

      return {
        zoom: nextZoom,
        panX: nextPanX,
        panY: nextPanY
      };
    });
  }, []);

  const fitView = useCallback(() => {
    if (cards.length === 0 || !containerRef.current) return;
    const minX = Math.min(...cards.map(c => c.x));
    const maxX = Math.max(...cards.map(c => c.x + c.width));
    const minY = Math.min(...cards.map(c => c.y));
    const maxY = Math.max(...cards.map(c => c.y + (c.type === 'video' ? 440 : 380)));

    const width = maxX - minX;
    const height = maxY - minY;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;

    const targetZoom = Math.min(1.2, Math.max(0.4, Math.min((containerW - 160) / width, (containerH - 160) / height)));
    const targetPanX = (containerW - width * targetZoom) / 2 - minX * targetZoom;
    const targetPanY = (containerH - height * targetZoom) / 2 - minY * targetZoom;

    setTransform({
      zoom: targetZoom,
      panX: targetPanX,
      panY: targetPanY
    });
  }, [cards]);

  const focusSelection = useCallback((cardId?: string) => {
    const id = cardId ?? selectedCardId;
    const target = cards.find(c => c.id === id);
    if (!target || !containerRef.current) return;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const targetZoom = 1;
    const targetPanX = containerW / 2 - (target.x + target.width / 2) * targetZoom;
    const targetPanY = containerH / 2 - (target.y + 180) * targetZoom;

    setTransform({
      zoom: targetZoom,
      panX: targetPanX,
      panY: targetPanY
    });
  }, [cards, selectedCardId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      mousePosRef.current = { x: e.clientX, y: e.clientY };

      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        zoomAtPoint(z => z * factor, e.clientX, e.clientY);
      } else {
        const deltaX = e.shiftKey ? e.deltaY : e.deltaX;
        const deltaY = e.shiftKey ? 0 : e.deltaY;
        setTransform(prev => ({
          ...prev,
          panX: prev.panX - deltaX,
          panY: prev.panY - deltaY
        }));
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, [zoomAtPoint]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === '0') {
        fitView();
      } else if (e.key === '1') {
        zoomAtPoint(1);
      } else if (e.key === '=' || e.key === '+') {
        zoomAtPoint(z => z * 1.15);
      } else if (e.key === '-') {
        zoomAtPoint(z => z / 1.15);
      } else if (e.key === 'f' || e.key === 'F') {
        focusSelection();
      } else if (e.key === ' ') {
        setActiveTool('hand');
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setActiveTool('select');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [fitView, focusSelection, zoomAtPoint]);

  const handleMouseDownCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'hand' || e.button === 1 || e.target === e.currentTarget) {
      setIsPanning(true);
      startPanRef.current = { x: e.clientX - transform.panX, y: e.clientY - transform.panY };
      setOpenDropdownCardId(null);
      setMentionPickerCardId(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };

    if (isPanning) {
      setTransform(prev => ({
        ...prev,
        panX: e.clientX - startPanRef.current.x,
        panY: e.clientY - startPanRef.current.y
      }));
    } else if (draggingCardId) {
      const newX = (e.clientX - transform.panX) / transform.zoom - dragOffsetRef.current.x;
      const newY = (e.clientY - transform.panY) / transform.zoom - dragOffsetRef.current.y;
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
    setSelectedCardId(card.id);
    setDraggingCardId(card.id);
    dragOffsetRef.current = {
      x: (e.clientX - transform.panX) / transform.zoom - card.x,
      y: (e.clientY - transform.panY) / transform.zoom - card.y
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
    setOpenDropdownCardId(null);
  };

  const selectImageModel = (cardId: string, modelId: string) => {
    const modelDef = IMAGE_MODELS.find(m => m.id === modelId);
    setCards(prev => prev.map(c => {
      if (c.id !== cardId) return c;
      return {
        ...c,
        model: modelId,
        imageTier: modelDef?.defaultTier ?? '2K',
        customPixels: modelDef?.defaultCustomPixel ?? '2048x1024',
        imageMode: 'single'
      };
    }));
    setOpenDropdownCardId(null);
  };

  const setTaskMode = (videoCardId: string, newMode: VideoTaskMode) => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      let newRefs = c.references ?? [];
      let newRatio = c.ratio;

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
    setMentionPickerCardId(null);
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
    // Image Payload
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
      title: type === 'image' ? `原画构思 ${nextIndex}` : `镜头 ${nextIndex}`,
      tagIndex: nextIndex,
      x: 200 - transform.panX / transform.zoom,
      y: 200 - transform.panY / transform.zoom,
      width: type === 'video' ? 460 : 330,
      prompt: type === 'image' ? '输入画面主体与氛围描述...' : '输入运镜指令，可使用 @图1 @图2 引用...',
      model: type === 'image' ? 'doubao-seedream-5-0-pro-260628' : 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      isExpanded: false,
      activeParamTab: 'specs',
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
      background: 'opaque',
      references: []
    };
    setCards(prev => [...prev, newCard]);
    setSelectedCardId(newCard.id);
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative bg-[#090b10] overflow-hidden select-none cursor-default font-sans"
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Banner Header */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3 bg-[#11131c]/95 backdrop-blur-xl border border-slate-700/60 rounded-2xl px-4 py-2.5 shadow-2xl">
        <div className="p-1.5 rounded-xl bg-indigo-500/20 text-indigo-400">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-xs">媒体工作台 • 零漂移光标缩放引擎</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono">
              Ark & MiniMax Full Specs
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            光标所在绝对坐标定点缩放 • 快捷键 0 全览 / 1 原始大小 / + - 放大缩小 / Space 漫游 • 全量参数折叠抽屉
          </p>
        </div>
      </div>

      {/* Floating Top-Right Tool Dock */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-[#11131c]/95 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-1.5 shadow-2xl text-slate-200">
        <button
          type="button"
          onClick={() => setActiveTool('select')}
          className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition ${activeTool === 'select' ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30' : 'hover:bg-slate-800 text-slate-400'}`}
        >
          <MousePointer className="w-3.5 h-3.5" /> 选择 (V)
        </button>
        <button
          type="button"
          onClick={() => setActiveTool('hand')}
          className={`px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition ${activeTool === 'hand' ? 'bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30' : 'hover:bg-slate-800 text-slate-400'}`}
        >
          <Hand className="w-3.5 h-3.5" /> 平移 (Space)
        </button>
        <div className="w-[1px] h-5 bg-slate-700 mx-1" />
        <button
          type="button"
          onClick={() => addNewCard('image')}
          className="px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 bg-pink-500/15 hover:bg-pink-500/25 text-pink-300 font-medium border border-pink-500/30 transition"
        >
          <Plus className="w-3.5 h-3.5" /> +生图卡片
        </button>
        <button
          type="button"
          onClick={() => addNewCard('video')}
          className="px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 font-medium border border-indigo-500/30 transition"
        >
          <Plus className="w-3.5 h-3.5" /> +视频卡片
        </button>
      </div>

      {/* Floating Bottom-Right Zoom & Navigation Controls */}
      <div className="absolute bottom-20 right-6 z-20 flex items-center gap-1 bg-[#11131c]/95 backdrop-blur-xl border border-slate-700/60 rounded-2xl p-1.5 shadow-2xl text-slate-300">
        <button
          type="button"
          onClick={fitView}
          className="px-2.5 py-1.5 hover:bg-slate-800 rounded-xl text-xs font-medium flex items-center gap-1.5 text-slate-300 hover:text-white transition"
          title="适屏全览 (快捷键 0)"
        >
          <Compass className="w-4 h-4 text-indigo-400" /> 全览 (0)
        </button>

        <button
          type="button"
          onClick={() => focusSelection()}
          className="px-2.5 py-1.5 hover:bg-slate-800 rounded-xl text-xs font-medium flex items-center gap-1.5 text-slate-300 hover:text-white transition"
          title="聚焦选中卡片 (快捷键 F)"
        >
          <Focus className="w-4 h-4 text-pink-400" /> 聚焦 (F)
        </button>

        <div className="w-[1px] h-4 bg-slate-700 mx-1" />

        <button
          type="button"
          onClick={() => zoomAtPoint(z => z / 1.15)}
          className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          title="以光标为中心缩小 (-)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => zoomAtPoint(1)}
          className="px-2 py-1 hover:bg-slate-800 rounded-lg text-xs font-mono text-slate-300 font-bold min-w-[52px] text-center"
          title="重置为 100% (快捷键 1)"
        >
          {Math.round(transform.zoom * 100)}%
        </button>

        <button
          type="button"
          onClick={() => zoomAtPoint(z => z * 1.15)}
          className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition"
          title="以光标为中心放大 (+)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      {/* Infinite Canvas Surface */}
      <div
        className="w-full h-full origin-top-left"
        style={{
          transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`,
          backgroundImage: 'radial-gradient(circle, #212638 1.2px, transparent 1.2px)',
          backgroundSize: '28px 28px'
        }}
      >
        {/* SVG Multi-Ray Connections */}
        <svg className="absolute top-0 left-0 w-[6000px] h-[6000px] pointer-events-none z-0">
          <defs>
            <linearGradient id="rayGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ec4899" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.9" />
            </linearGradient>
          </defs>
          {cards.filter(c => c.type === 'video').map(videoCard => {
            return (videoCard.references ?? []).map(ref => {
              const srcCard = cards.find(c => c.id === ref.cardId);
              if (!srcCard) return null;

              const startX = srcCard.x + srcCard.width;
              const startY = srcCard.y + 110;
              const endX = videoCard.x;
              const endY = videoCard.y + 110;
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
                  <g transform={`translate(${midX - 24}, ${midY - 9})`}>
                    <rect width="48" height="18" rx="9" fill="#11131c" stroke="#6366f1" strokeWidth="1.5" />
                    <text x="24" y="13" fill="#a5b4fc" fontSize="9" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
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
          const isSelected = selectedCardId === card.id;
          const currentVideoModel = VIDEO_MODELS.find(m => m.id === card.model) ?? VIDEO_MODELS[0];
          const currentImageModel = IMAGE_MODELS.find(m => m.id === card.model) ?? IMAGE_MODELS[0];

          const currentTier = card.imageTier ?? currentImageModel.defaultTier;
          const currentRatio = card.imageRatioPreset ?? '16:9';
          const mappedPixels = SEEDREAM_PIXEL_MAP[currentTier]?.[currentRatio] ?? '自动映射';

          return (
            <div
              key={card.id}
              onClick={() => setSelectedCardId(card.id)}
              style={{
                transform: `translate(${card.x}px, ${card.y}px)`,
                width: `${card.width}px`
              }}
              className={`absolute z-10 bg-[#12141e]/98 border rounded-2xl shadow-2xl overflow-visible text-slate-200 transition-all ${
                isSelected
                  ? 'border-indigo-500/90 ring-4 ring-indigo-500/20 shadow-indigo-500/30'
                  : 'border-slate-700/70 hover:border-slate-600'
              }`}
            >
              {/* Card Header */}
              <div
                onMouseDown={e => handleStartDragCard(e, card)}
                className="bg-slate-800/80 px-3.5 py-2 border-b border-slate-700/80 rounded-t-2xl flex items-center justify-between cursor-grab active:cursor-grabbing"
              >
                <div className="flex items-center gap-1.5">
                  <Move className="w-3 h-3 text-slate-400" />
                  <span className="text-xs font-bold text-white tracking-wide">{card.title}</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 text-slate-300 border border-slate-700">
                    {card.type === 'image' ? currentImageModel.name.split(' ')[1] : currentVideoModel.name}
                  </span>

                  <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    card.type === 'image'
                      ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  }`}>
                    @图{card.tagIndex}
                  </span>

                  <button
                    type="button"
                    onClick={() => setShowJsonInspectorCardId(showJsonInspectorCardId === card.id ? null : card.id)}
                    className="p-1 rounded hover:bg-slate-700/60 text-slate-400 hover:text-indigo-300 transition"
                    title="API Payload"
                  >
                    <Code className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* JSON Payload Inspector */}
              {showJsonInspectorCardId === card.id && (
                <div className="bg-[#08090e] p-2.5 border-b border-slate-800 text-[10px] font-mono text-emerald-400 max-h-44 overflow-y-auto space-y-1">
                  <div className="flex justify-between text-slate-400 border-b border-slate-800 pb-1">
                    <span>📡 序列化 API Payload</span>
                    <button type="button" onClick={() => setShowJsonInspectorCardId(null)} className="hover:text-white">✕</button>
                  </div>
                  <pre className="whitespace-pre-wrap">{JSON.stringify(getCompiledJsonPayload(card), null, 2)}</pre>
                </div>
              )}

              {/* Card Body */}
              <div className="p-3 space-y-2.5">
                {/* 1. IMAGE CARD */}
                {card.type === 'image' && (
                  <>
                    <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-video flex items-center justify-center group">
                      <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-purple-950 to-pink-950 flex flex-col items-center justify-center p-3 text-center">
                        <ImageIcon className="w-6 h-6 text-pink-400/80 mb-1" />
                        <span className="text-xs text-pink-200 font-semibold">{currentImageModel.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {card.sizeMode === 'custom_pixels' ? card.customPixels : `${currentTier} • ${mappedPixels}`}
                        </span>
                      </div>
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] font-mono font-bold text-pink-300 border border-pink-500/30">
                        @图{card.tagIndex}
                      </div>
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> 就绪
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs bg-[#0b0d14] p-1.5 px-2.5 rounded-xl border border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenDropdownCardId(openDropdownCardId === card.id ? null : card.id)}
                          className="font-semibold text-pink-300 flex items-center gap-1 hover:text-pink-200 text-[11px]"
                        >
                          {currentImageModel.name.split(' ')[1]} {currentImageModel.name.split(' ')[2]} <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>
                        <span className="text-slate-600">•</span>
                        <span className="font-mono text-[10px] text-slate-300">
                          {card.sizeMode === 'custom_pixels' ? card.customPixels : `${currentTier} (${currentRatio})`}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, isExpanded: !c.isExpanded } : c))}
                        className={`text-[10px] font-medium flex items-center gap-1 px-2 py-0.5 rounded-lg border transition ${
                          card.isExpanded ? 'bg-pink-600 text-white border-pink-500' : 'text-slate-400 hover:text-white bg-slate-800/80 border-slate-700'
                        }`}
                      >
                        <Settings2 className="w-3 h-3" />
                        {card.isExpanded ? '收起配置' : '展开参数'}
                      </button>
                    </div>

                    {openDropdownCardId === card.id && (
                      <div className="bg-[#161925] border border-slate-700 rounded-xl p-1.5 shadow-2xl z-30 space-y-1 animate-in fade-in">
                        {IMAGE_MODELS.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => selectImageModel(card.id, m.id)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs transition ${
                              card.model === m.id ? 'bg-pink-600 text-white font-bold' : 'hover:bg-slate-800 text-slate-200'
                            }`}
                          >
                            <span>{m.name}</span>
                            <span className="text-[10px] opacity-70">{m.tag}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {card.isExpanded && (
                      <div className="bg-[#0b0d14] border border-slate-800 p-2.5 rounded-xl space-y-2 text-xs animate-in fade-in">
                        <div className="flex items-center gap-1 pb-1.5 border-b border-slate-800 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, activeParamTab: 'specs' } : c))}
                            className={`px-2 py-0.5 rounded-md font-semibold transition ${
                              card.activeParamTab === 'specs' || !card.activeParamTab ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            尺寸规格 (Size)
                          </button>
                          <button
                            type="button"
                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, activeParamTab: 'advanced' } : c))}
                            className={`px-2 py-0.5 rounded-md font-semibold transition ${
                              card.activeParamTab === 'advanced' ? 'bg-pink-600 text-white' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            模式与输出 (Mode/Output)
                          </button>
                        </div>

                        {(card.activeParamTab === 'specs' || !card.activeParamTab) && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-1 bg-[#12141e] p-1 rounded-lg border border-slate-800 text-[10px]">
                              <button
                                type="button"
                                onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, sizeMode: 'tier' } : c))}
                                className={`py-1 rounded font-medium ${card.sizeMode === 'tier' || !card.sizeMode ? 'bg-pink-600 text-white' : 'text-slate-400'}`}
                              >
                                方式1: 档位预设
                              </button>
                              <button
                                type="button"
                                onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, sizeMode: 'custom_pixels' } : c))}
                                className={`py-1 rounded font-medium ${card.sizeMode === 'custom_pixels' ? 'bg-pink-600 text-white' : 'text-slate-400'}`}
                              >
                                方式2: 显式像素
                              </button>
                            </div>

                            {card.sizeMode === 'tier' || !card.sizeMode ? (
                              <>
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-slate-400">档位:</span>
                                  <div className="flex gap-1">
                                    {currentImageModel.tiers.map(tr => (
                                      <button
                                        key={tr}
                                        type="button"
                                        onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageTier: tr } : c))}
                                        className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                                          currentTier === tr ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400'
                                        }`}
                                      >
                                        {tr}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <div className="flex justify-between text-[10px]">
                                    <span className="text-slate-400">宽高比映射:</span>
                                    <span className="font-mono text-pink-300 font-bold">{mappedPixels}</span>
                                  </div>
                                  <div className="grid grid-cols-4 gap-1 text-[9px] font-mono">
                                    {(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] as const).map(rt => (
                                      <button
                                        key={rt}
                                        type="button"
                                        onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageRatioPreset: rt } : c))}
                                        className={`py-1 rounded font-semibold ${
                                          currentRatio === rt ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400'
                                        }`}
                                      >
                                        {rt}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex justify-between text-[10px]">
                                  <span className="text-slate-400">自定义宽高像素:</span>
                                  <span className="font-mono text-[9px] text-slate-500">{currentImageModel.pixelRangeText}</span>
                                </div>
                                <input
                                  type="text"
                                  value={card.customPixels ?? currentImageModel.defaultCustomPixel}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setCards(prev => prev.map(c => c.id === card.id ? { ...c, customPixels: val } : c));
                                  }}
                                  className="w-full bg-[#161822] border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono text-pink-300 focus:outline-none focus:border-pink-500"
                                  placeholder="例如 2048x1024"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {card.activeParamTab === 'advanced' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">模式:</span>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageMode: 'single' } : c))}
                                  className={`px-2 py-0.5 rounded ${card.imageMode === 'single' || !card.imageMode ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                >
                                  单图
                                </button>
                                <button
                                  type="button"
                                  disabled={!currentImageModel.supportsLayerDecomp}
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageMode: 'layer_decomp' } : c))}
                                  className={`px-2 py-0.5 rounded ${!currentImageModel.supportsLayerDecomp ? 'opacity-30' : card.imageMode === 'layer_decomp' ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                >
                                  图层拆分 (16层)
                                </button>
                                <button
                                  type="button"
                                  disabled={!currentImageModel.supportsSequential}
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageMode: 'sequential' } : c))}
                                  className={`px-2 py-0.5 rounded ${!currentImageModel.supportsSequential ? 'opacity-30' : card.imageMode === 'sequential' ? 'bg-pink-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                >
                                  连环组图 (15张)
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[10px]">
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, imageFormat: c.imageFormat === 'png' ? 'jpeg' : 'png' } : c))}
                                  className="px-2 py-0.5 rounded bg-pink-500/10 text-pink-300 border border-pink-500/20 font-mono font-bold"
                                >
                                  格式: {card.imageFormat?.toUpperCase()}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, background: c.background === 'transparent' ? 'opaque' : 'transparent' } : c))}
                                  className={`px-2 py-0.5 rounded border ${card.background === 'transparent' ? 'bg-pink-500/20 text-pink-200 border-pink-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                                >
                                  {card.background === 'transparent' ? '透明底 (PNG)' : '不透明底'}
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, watermark: !c.watermark } : c))}
                                className={`px-2 py-0.5 rounded border ${!card.watermark ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                              >
                                {!card.watermark ? '无水印' : '含水印'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <textarea
                      value={card.prompt}
                      onChange={e => {
                        const val = e.target.value;
                        setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                      }}
                      className="w-full bg-[#0b0d14] border border-slate-700/70 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-pink-500 resize-none h-14 leading-relaxed"
                      placeholder="输入画面描述..."
                    />

                    <button
                      type="button"
                      onClick={() => triggerGenerate(card.id)}
                      disabled={card.status === 'generating'}
                      className="w-full py-2 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-pink-600/25 transition active:scale-98"
                    >
                      {card.status === 'generating' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中 {card.progress}%
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" /> 生成 {currentImageModel.name.split(' ')[1]} 图片
                        </>
                      )}
                    </button>
                  </>
                )}

                {/* ========================================================================= */}
                {/* 2. VIDEO CARD                                                             */}
                {/* ========================================================================= */}
                {card.type === 'video' && (
                  <>
                    <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-video flex items-center justify-center group">
                      <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-slate-900 to-cyan-950 flex flex-col items-center justify-center p-3 text-center">
                        <Film className="w-6 h-6 text-indigo-400 mb-1" />
                        <span className="text-xs text-indigo-200 font-semibold">{currentVideoModel.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {card.resolution} • {card.duration}s • {card.ratio} • {card.references?.length ?? 0}素材
                        </span>
                      </div>
                      <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] font-mono font-bold text-indigo-300 border border-indigo-500/30">
                        @图{card.tagIndex}
                      </div>
                      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-2.5 h-2.5" /> 就绪
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs bg-[#0b0d14] p-1.5 px-2.5 rounded-xl border border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenDropdownCardId(openDropdownCardId === card.id ? null : card.id)}
                          className="font-semibold text-indigo-300 flex items-center gap-1 hover:text-indigo-200 text-[11px]"
                        >
                          {currentVideoModel.name} <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>
                        <span className="text-slate-600">•</span>
                        <span className="font-mono text-[10px] text-slate-300">
                          {card.resolution} / {card.duration}s / {card.ratio}
                        </span>
                        {card.generateAudio && (
                          <Volume2 className="w-3 h-3 text-emerald-400" title="音频已开启" />
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, isExpanded: !c.isExpanded } : c))}
                        className={`text-[10px] font-medium flex items-center gap-1 px-2 py-0.5 rounded-lg border transition ${
                          card.isExpanded ? 'bg-indigo-600 text-white border-indigo-500' : 'text-slate-400 hover:text-white bg-slate-800/80 border-slate-700'
                        }`}
                      >
                        <Settings2 className="w-3 h-3" />
                        {card.isExpanded ? '收起配置' : '展开参数'}
                      </button>
                    </div>

                    {openDropdownCardId === card.id && (
                      <div className="bg-[#161925] border border-slate-700 rounded-xl p-1.5 shadow-2xl z-30 space-y-1 animate-in fade-in">
                        {VIDEO_MODELS.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => selectVideoModel(card.id, m.id)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs transition ${
                              card.model === m.id ? 'bg-indigo-600 text-white font-bold' : 'hover:bg-slate-800 text-slate-200'
                            }`}
                          >
                            <span>{m.name}</span>
                            <span className="text-[10px] opacity-70">{m.tag}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {card.isExpanded && (
                      <div className="bg-[#0b0d14] border border-slate-800 p-2.5 rounded-xl space-y-2 text-xs animate-in fade-in">
                        <div className="flex items-center gap-1 pb-1.5 border-b border-slate-800 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, activeParamTab: 'specs' } : c))}
                            className={`px-2 py-0.5 rounded-md font-semibold transition ${
                              card.activeParamTab === 'specs' || !card.activeParamTab ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            基础规格 (Specs)
                          </button>
                          <button
                            type="button"
                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, activeParamTab: 'refs' } : c))}
                            className={`px-2 py-0.5 rounded-md font-semibold transition ${
                              card.activeParamTab === 'refs' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            素材槽位 ({card.references?.length ?? 0}/{currentVideoModel.maxRefs})
                          </button>
                          <button
                            type="button"
                            onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, activeParamTab: 'advanced' } : c))}
                            className={`px-2 py-0.5 rounded-md font-semibold transition ${
                              card.activeParamTab === 'advanced' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            高级控制 (Audio/Opt)
                          </button>
                        </div>

                        {(card.activeParamTab === 'specs' || !card.activeParamTab) && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">模式:</span>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => setTaskMode(card.id, 'all_modal')}
                                  className={`px-2 py-0.5 rounded ${card.mode === 'all_modal' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                >
                                  全模态多参考
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTaskMode(card.id, 'first_last_frame')}
                                  className={`px-2 py-0.5 rounded ${card.mode === 'first_last_frame' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                >
                                  首尾帧严格
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTaskMode(card.id, 'text_to_video')}
                                  className={`px-2 py-0.5 rounded ${card.mode === 'text_to_video' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                >
                                  纯文生
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">分辨率:</span>
                              <div className="flex gap-1">
                                {currentVideoModel.resolutions.map(res => (
                                  <button
                                    key={res}
                                    type="button"
                                    onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, resolution: res } : c))}
                                    className={`px-2 py-0.5 rounded font-mono font-bold ${card.resolution === res ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                  >
                                    {res}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">时长:</span>
                              <div className="flex gap-1 flex-wrap justify-end">
                                {currentVideoModel.durations.map(dur => (
                                  <button
                                    key={dur}
                                    type="button"
                                    onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, duration: dur } : c))}
                                    className={`px-2 py-0.5 rounded font-mono font-bold ${card.duration === dur ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                  >
                                    {dur === -1 ? '自适应' : `${dur}s`}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-slate-400">画面比例:</span>
                              <div className="flex gap-1 flex-wrap justify-end">
                                {card.mode === 'first_last_frame' ? (
                                  <span className="px-2 py-0.5 rounded bg-indigo-600/30 text-indigo-300 font-mono text-[9px]">
                                    自适应首帧 (adaptive)
                                  </span>
                                ) : (
                                  currentVideoModel.ratios.map(rt => (
                                    <button
                                      key={rt}
                                      type="button"
                                      onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, ratio: rt } : c))}
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${card.ratio === rt ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}
                                    >
                                      {rt}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {card.activeParamTab === 'refs' && (
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-[10px]">
                              <span className="text-slate-400">已绑定素材列表:</span>
                              <button
                                type="button"
                                onClick={() => setMentionPickerCardId(mentionPickerCardId === card.id ? null : card.id)}
                                className="text-indigo-400 hover:text-indigo-300 font-medium px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20"
                              >
                                + 引入画布图片
                              </button>
                            </div>

                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {card.references && card.references.length > 0 ? (
                                card.references.map(ref => (
                                  <div key={ref.cardId} className="flex items-center justify-between bg-[#141722] border border-slate-800 px-2 py-1 rounded text-[10px]">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono font-bold text-pink-400">@图{ref.tagIndex}</span>
                                      <span className="text-slate-300 truncate max-w-[120px]">{ref.label}</span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => removeReference(card.id, ref.cardId)}
                                      className="text-slate-500 hover:text-red-400 ml-2"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <div className="text-[10px] text-slate-500 text-center py-2">暂未引入参考图片</div>
                              )}
                            </div>
                          </div>
                        )}

                        {card.activeParamTab === 'advanced' && (
                          <div className="space-y-2 text-[10px]">
                            {currentVideoModel.supportsAudio && (
                              <div className="flex justify-between items-center">
                                <span className="text-slate-400">原生音频生成:</span>
                                <button
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, generateAudio: !c.generateAudio } : c))}
                                  className={`px-2 py-0.5 rounded border ${card.generateAudio ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                                >
                                  {card.generateAudio ? '开启自动配音' : '静音模式'}
                                </button>
                              </div>
                            )}

                            {currentVideoModel.supportsMov && (
                              <div className="flex justify-between items-center">
                                <span className="text-slate-400">封装格式:</span>
                                <button
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, outputFormat: c.outputFormat === 'mp4' ? 'mov' : 'mp4' } : c))}
                                  className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono font-bold"
                                >
                                  {card.outputFormat?.toUpperCase()}
                                </button>
                              </div>
                            )}

                            {currentVideoModel.provider === 'minimax' && (
                              <div className="flex justify-between items-center">
                                <span className="text-slate-400">Prompt 智能优化器:</span>
                                <button
                                  type="button"
                                  onClick={() => setCards(prev => prev.map(c => c.id === card.id ? { ...c, promptOptimizer: !c.promptOptimizer } : c))}
                                  className={`px-2 py-0.5 rounded border ${card.promptOptimizer ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 border-slate-700'}`}
                                >
                                  {card.promptOptimizer ? '已开启' : '关闭'}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {card.mode !== 'text_to_video' && (
                      <div className="flex items-center justify-between bg-[#0b0d14] px-2 py-1 rounded-xl border border-slate-800 text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Layers className="w-3 h-3 text-indigo-400" /> 参考:
                          </span>
                          {card.references && card.references.length > 0 ? (
                            card.references.map(ref => (
                              <span
                                key={ref.cardId}
                                className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-300 border border-pink-500/30"
                              >
                                @图{ref.tagIndex}
                                <button
                                  type="button"
                                  onClick={() => removeReference(card.id, ref.cardId)}
                                  className="hover:text-red-400 ml-0.5"
                                >
                                  ×
                                </button>
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-500">无绑定素材</span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setMentionPickerCardId(mentionPickerCardId === card.id ? null : card.id)}
                          className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 flex-shrink-0"
                        >
                          + 引入
                        </button>
                      </div>
                    )}

                    {mentionPickerCardId === card.id && (
                      <div className="bg-[#161925] border border-indigo-500/40 rounded-xl p-1.5 shadow-2xl z-30 space-y-1 animate-in fade-in">
                        <span className="text-[9px] font-semibold text-slate-400 px-1 block">选择画布生图素材：</span>
                        {availableImageCards.map(img => (
                          <button
                            key={img.id}
                            type="button"
                            onClick={() => attachReference(card.id, img)}
                            className="w-full text-left px-2 py-1 rounded-lg hover:bg-indigo-600/30 flex items-center justify-between text-xs transition"
                          >
                            <span className="font-mono text-pink-400 text-[10px]">@图{img.tagIndex} {img.title}</span>
                            <span className="text-[9px] text-indigo-300">+ 绑定</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <textarea
                      value={card.prompt}
                      onChange={e => {
                        const val = e.target.value;
                        setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                      }}
                      className="w-full bg-[#0b0d14] border border-slate-700/70 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-16 leading-relaxed"
                      placeholder="运镜描述，输入 @图1 @图2 引用素材..."
                    />

                    <button
                      type="button"
                      onClick={() => triggerGenerate(card.id)}
                      disabled={card.status === 'generating'}
                      className="w-full py-2 bg-gradient-to-r from-pink-600 via-indigo-600 to-cyan-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/25 transition active:scale-98"
                    >
                      {card.status === 'generating' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 渲染中 {card.progress}%
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" /> 生成 {currentVideoModel.name} 视频
                        </>
                      )}
                    </button>
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
