import React, { useState, useRef } from 'react';
import {
  Sparkles, Video, Image as ImageIcon, Plus, MousePointer, Hand, Move,
  ZoomIn, ZoomOut, Film, Trash2, CheckCircle2, Loader2, AtSign, X, Layers,
  ChevronDown, ExternalLink, HelpCircle, ArrowRight
} from 'lucide-react';

export type VideoTaskMode = 'all_modal' | 'first_last_frame' | 'text_to_video';

export interface ReferenceItem {
  cardId: string;
  tagIndex: number; // e.g., 1 for @图1
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
  mode?: VideoTaskMode;
  duration?: number;
  ratio?: string;
  resolution?: string;
  references?: ReferenceItem[];
}

export const VariantB_LovartSpatial: React.FC = () => {
  const [cards, setCards] = useState<SpatialCard[]>([
    {
      id: 'card-img-1',
      type: 'image',
      title: '赛博机甲少女设定',
      tagIndex: 1,
      x: 60,
      y: 120,
      width: 300,
      prompt: '特写肖像，银发机甲少女，深邃眼眸，精细金属质感外骨骼，Vogue 封面光影',
      model: 'doubao-seedream-5-0-pro',
      status: 'done',
      progress: 100
    },
    {
      id: 'card-img-2',
      type: 'image',
      title: '未来都市雨夜街道',
      tagIndex: 2,
      x: 60,
      y: 470,
      width: 300,
      prompt: '赛博朋克都市雨夜全景，湿漉漉的沥青路面，红蓝霓虹灯招牌倒影，电影级景深',
      model: 'doubao-seedream-5-0-pro',
      status: 'done',
      progress: 100
    },
    {
      id: 'card-vid-1',
      type: 'video',
      title: 'Seedance 2.5 电影镜头',
      tagIndex: 3,
      x: 480,
      y: 140,
      width: 460,
      mode: 'all_modal',
      prompt: '以 @图1 为首帧与主角形象，置身于 @图2 的雨夜街道中。少女低头沉思随后抬眼望向镜头，摄影机缓慢推近特写，雨滴从发梢滑落，霓虹光晕在金属装甲表面流转 --rt 16:9',
      model: 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      duration: 5,
      ratio: '16:9',
      resolution: '720p',
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
  const [mentionTargetCardId, setMentionTargetCardId] = useState<string | null>(null);

  const handleMouseDownCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'hand' || e.button === 1 || e.target === e.currentTarget) {
      setIsPanning(true);
      startPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
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

  // Switch task mode (Strictly enforcing Ark API mutual exclusivity)
  const setTaskMode = (videoCardId: string, newMode: VideoTaskMode) => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      let newRefs = c.references ?? [];
      if (newMode === 'text_to_video') {
        newRefs = [];
      } else if (newMode === 'first_last_frame') {
        // Enforce max 2 refs, first as first_frame, second as last_frame
        newRefs = newRefs.slice(0, 2).map((r, idx) => ({
          ...r,
          role: idx === 0 ? 'first_frame' : 'last_frame'
        }));
      } else if (newMode === 'all_modal') {
        // In all_modal mode, all inputs are role=reference_image (frame roles specified via prompt @)
        newRefs = newRefs.map(r => ({ ...r, role: 'reference_image' }));
      }
      return {
        ...c,
        mode: newMode,
        references: newRefs
      };
    }));
  };

  // Attach reference in compliance with selected mode
  const attachReference = (videoCardId: string, imageCard: SpatialCard) => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      const currentMode = c.mode ?? 'all_modal';
      if (currentMode === 'text_to_video') return c;

      const currentRefs = c.references ?? [];
      if (currentRefs.some(r => r.cardId === imageCard.id)) return c;

      // Restrict first_last_frame mode to max 2 images
      if (currentMode === 'first_last_frame' && currentRefs.length >= 2) {
        return c;
      }

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

  const addNewCard = (type: 'image' | 'video') => {
    const nextIndex = cards.length + 1;
    const newCard: SpatialCard = {
      id: `card-${Date.now()}`,
      type,
      title: type === 'image' ? `新建原画图 ${nextIndex}` : `新建视频镜头 ${nextIndex}`,
      tagIndex: nextIndex,
      x: 180 - pan.x,
      y: 180 - pan.y,
      width: type === 'video' ? 460 : 300,
      prompt: type === 'image' ? '输入生图描述...' : '输入运镜指令，可通过 @图1 @图2 指代首帧或主体...',
      model: type === 'image' ? 'doubao-seedream-5-0-pro' : 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      mode: 'all_modal',
      duration: 5,
      ratio: '16:9',
      references: []
    };
    setCards(prev => [...prev, newCard]);
  };

  return (
    <div
      className="w-full h-full relative bg-[#0c0e15] overflow-hidden select-none cursor-default font-sans"
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Banner & Mode Info */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3 bg-[#151823]/95 backdrop-blur-md border border-slate-700/60 rounded-2xl px-4 py-2.5 shadow-2xl">
        <div className="p-1.5 rounded-xl bg-indigo-500/20 text-indigo-400">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-xs">Lovart 无限画布 • Seedance 2.5 / MiniMax 媒体工作台</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium font-mono">
              Ark Native Spec
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            符合方舟 API 契约：全模态模式支持多图输入并在 Prompt 中以 <span className="text-amber-300 font-mono font-bold">@图N</span> 精准指代首尾帧与主体
          </p>
        </div>
      </div>

      {/* Floating Toolbar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-[#151823]/95 backdrop-blur-md border border-slate-700/60 rounded-2xl p-1.5 shadow-2xl text-slate-200">
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
      <div className="absolute bottom-20 right-6 z-20 flex flex-col gap-1 bg-[#151823]/90 backdrop-blur border border-slate-700/60 rounded-xl p-1 text-slate-300 shadow-xl">
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
          backgroundImage: 'radial-gradient(circle, #242938 1.2px, transparent 1.2px)',
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
                    <rect width="52" height="20" rx="10" fill="#151823" stroke="#6366f1" strokeWidth="1.5" />
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
        {cards.map(card => (
          <div
            key={card.id}
            style={{
              transform: `translate(${card.x}px, ${card.y}px)`,
              width: `${card.width}px`
            }}
            className={`absolute z-10 bg-[#151823]/95 border rounded-2xl shadow-2xl overflow-visible text-slate-200 transition-shadow ${
              draggingCardId === card.id ? 'border-indigo-500 ring-4 ring-indigo-500/20 shadow-indigo-500/30 scale-[1.01]' : 'border-slate-700/80 hover:border-slate-600'
            }`}
          >
            {/* Card Header */}
            <div
              onMouseDown={e => handleStartDragCard(e, card)}
              className="bg-slate-800/80 px-4 py-2.5 border-b border-slate-700/80 rounded-t-2xl flex items-center justify-between cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-center gap-2">
                <Move className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold text-white tracking-wide">{card.title}</span>
              </div>

              <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                card.type === 'image'
                  ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                  : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
              }`}>
                @图{card.tagIndex}
              </span>
            </div>

            {/* Card Body */}
            <div className="p-4 space-y-3.5">
              {/* IMAGE CARD BODY */}
              {card.type === 'image' && (
                <>
                  <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-square flex items-center justify-center">
                    <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-purple-950 to-pink-950 flex flex-col items-center justify-center p-4 text-center">
                      <ImageIcon className="w-8 h-8 text-pink-400/80 mb-2" />
                      <span className="text-xs text-pink-200 font-medium">Seedream 5.0 (2048x2048)</span>
                    </div>
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] font-mono font-bold text-pink-300 border border-pink-500/30">
                      @图{card.tagIndex}
                    </div>
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> 就绪
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">生图提示词 (Prompt)</label>
                    <textarea
                      value={card.prompt}
                      onChange={e => {
                        const val = e.target.value;
                        setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                      }}
                      className="w-full bg-[#0d0f17] border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-pink-500 resize-none h-16"
                    />
                  </div>
                </>
              )}

              {/* VIDEO CARD BODY */}
              {card.type === 'video' && (
                <>
                  {/* Task Mode Switcher (Strictly enforcing Ark 5.1 mutual exclusivity) */}
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">生成场景模式 (Task Mode)</label>
                    <div className="grid grid-cols-3 gap-1 bg-[#0d0f17] p-1 rounded-xl border border-slate-800 text-[11px]">
                      <button
                        onClick={() => setTaskMode(card.id, 'all_modal')}
                        className={`py-1.5 rounded-lg font-medium transition ${
                          card.mode === 'all_modal'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="支持0~30张图，Prompt 中用 @图N 指定首帧/主体"
                      >
                        全模态参考
                      </button>
                      <button
                        onClick={() => setTaskMode(card.id, 'first_last_frame')}
                        className={`py-1.5 rounded-lg font-medium transition ${
                          card.mode === 'first_last_frame'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="严格保障首帧与尾帧 (最多2张)"
                      >
                        首尾帧严格模式
                      </button>
                      <button
                        onClick={() => setTaskMode(card.id, 'text_to_video')}
                        className={`py-1.5 rounded-lg font-medium transition ${
                          card.mode === 'text_to_video'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                        title="仅通过文本提示词直接生成"
                      >
                        纯文生视频
                      </button>
                    </div>
                  </div>

                  {/* Model Selector & Parameters */}
                  <div className="flex items-center justify-between text-xs bg-[#0d0f17] p-2.5 rounded-xl border border-slate-800">
                    <div className="flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-indigo-400" />
                      <select
                        value={card.model}
                        onChange={e => {
                          const val = e.target.value;
                          setCards(prev => prev.map(c => c.id === card.id ? { ...c, model: val } : c));
                        }}
                        className="bg-transparent text-xs font-semibold text-white focus:outline-none"
                      >
                        <option value="doubao-seedance-2-5-260628">Doubao Seedance 2.5 (30s)</option>
                        <option value="doubao-seedance-2-0-260128">Doubao Seedance 2.0 Pro</option>
                        <option value="MiniMax-H3">MiniMax H3 (2K 高动态)</option>
                        <option value="video-01">MiniMax Video-01</option>
                      </select>
                    </div>
                    <span className="font-mono text-[11px] text-indigo-300">16:9 • 720p • 5s</span>
                  </div>

                  {/* Multi-Image Reference Slots (Visible when not text_to_video) */}
                  {card.mode !== 'text_to_video' && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-indigo-400" />
                          {card.mode === 'all_modal'
                            ? `全模态参考素材池 (${card.references?.length ?? 0}/30)`
                            : `首尾帧素材 (${card.references?.length ?? 0}/2)`}
                        </span>
                        <button
                          onClick={() => setMentionTargetCardId(mentionTargetCardId === card.id ? null : card.id)}
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 bg-indigo-500/10 px-2 py-0.5 rounded-lg border border-indigo-500/20"
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
                              className="flex items-center justify-between bg-[#0d0f17] border border-slate-800 p-2 rounded-xl text-xs gap-2"
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
                        <div className="bg-[#1b1e2c] border border-indigo-500/40 rounded-xl p-2 shadow-2xl space-y-1 animate-in fade-in">
                          <span className="text-[10px] font-semibold text-slate-400 px-1 block">选择画布素材引入：</span>
                          {availableImageCards.map(img => (
                            <button
                              key={img.id}
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
                          在 Prompt 中写「以 @图N 为首帧/主体」指代角色
                        </span>
                      )}
                    </div>

                    <textarea
                      value={card.prompt}
                      onChange={e => {
                        const val = e.target.value;
                        setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                      }}
                      className="w-full bg-[#0d0f17] border border-slate-700/80 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-24 leading-relaxed font-sans"
                      placeholder="描述画面动作与运镜，输入 @图1 @图2 引用素材..."
                    />

                    {/* Quick Mention Insertion Chips */}
                    {card.mode === 'all_modal' && availableImageCards.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] text-slate-500">快捷插入:</span>
                        {availableImageCards.map(img => (
                          <button
                            key={img.id}
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
                    <div className="space-y-1 bg-[#0d0f17] p-2.5 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          火山方舟 / MiniMax 异步渲染中...
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
                        <span className="text-xs text-indigo-200 font-semibold">生成视频: seedance_r2v_final.mp4</span>
                        <span className="text-[10px] text-slate-400 mt-1">
                          {card.mode === 'all_modal' ? '全模态多图参考渲染' : '首尾帧严格渲染'}
                        </span>
                      </div>
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> 渲染完成
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => triggerGenerate(card.id)}
                      disabled={card.status === 'generating'}
                      className="w-full py-2.5 bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition active:scale-98"
                    >
                      <Sparkles className="w-4 h-4" /> 提交视频生成任务
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
