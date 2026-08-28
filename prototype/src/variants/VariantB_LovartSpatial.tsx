import React, { useState, useRef } from 'react';
import {
  Sparkles, Video, Image as ImageIcon, Plus, MousePointer, Hand, Move,
  ZoomIn, ZoomOut, Film, Trash2, CheckCircle2, Loader2, AtSign, X, Layers,
  ChevronDown, ExternalLink, HelpCircle
} from 'lucide-react';

export interface ReferenceItem {
  cardId: string;
  tagIndex: number; // e.g., 1 for @图1
  role: 'reference_image' | 'first_frame' | 'last_frame' | 'scene_ref';
  label: string;
}

export interface SpatialCard {
  id: string;
  type: 'image' | 'video';
  title: string;
  tagIndex: number; // e.g. 1 -> [图1]
  x: number;
  y: number;
  width: number;
  prompt: string;
  model: string;
  status: 'idle' | 'generating' | 'done';
  progress: number;
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
      title: '赛博机甲少女角色立绘',
      tagIndex: 1,
      x: 80,
      y: 120,
      width: 310,
      prompt: '特写肖像，银发机甲少女，深邃眼眸，精细金属质感外骨骼，Vogue 封面光影',
      model: 'doubao-seedream-5-0-pro',
      status: 'done',
      progress: 100
    },
    {
      id: 'card-img-2',
      type: 'image',
      title: '未来都市雨夜街道场景',
      tagIndex: 2,
      x: 80,
      y: 480,
      width: 310,
      prompt: '赛博朋克都市雨夜全景，湿漉漉的沥青路面，红蓝霓虹灯招牌倒影，电影级景深',
      model: 'doubao-seedream-5-0-pro',
      status: 'done',
      progress: 100
    },
    {
      id: 'card-vid-1',
      type: 'video',
      title: '多图参考电影镜头生成',
      tagIndex: 3,
      x: 520,
      y: 160,
      width: 440,
      prompt: '以 @图1 为主角形象，置身于 @图2 的雨夜街道中。少女低头沉思随后抬眼望向镜头，摄影机缓慢推近特写，雨滴从发梢滑落，霓虹光晕在金属装甲表面流转 --rt 16:9',
      model: 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      duration: 5,
      ratio: '16:9',
      resolution: '720p',
      references: [
        { cardId: 'card-img-1', tagIndex: 1, role: 'reference_image', label: '角色主体' },
        { cardId: 'card-img-2', tagIndex: 2, role: 'scene_ref', label: '背景场景' }
      ]
    }
  ]);

  const [activeTool, setActiveTool] = useState<'select' | 'hand'>('select');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const startPanRef = useRef({ x: 0, y: 0 });

  // Dragging cards
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // @ Mention popup state for target video card
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

  // Add reference to a video card
  const attachReference = (videoCardId: string, imageCard: SpatialCard, role: ReferenceItem['role'] = 'reference_image') => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      const currentRefs = c.references ?? [];
      if (currentRefs.some(r => r.cardId === imageCard.id)) return c;
      const newRef: ReferenceItem = {
        cardId: imageCard.id,
        tagIndex: imageCard.tagIndex,
        role,
        label: imageCard.title.slice(0, 8)
      };
      // Append @ mention into prompt if not present
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

  // Remove reference from a video card
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

  // Update role of a reference
  const updateReferenceRole = (videoCardId: string, refCardId: string, newRole: ReferenceItem['role']) => {
    setCards(prev => prev.map(c => {
      if (c.id !== videoCardId) return c;
      return {
        ...c,
        references: (c.references ?? []).map(r => r.cardId === refCardId ? { ...r, role: newRole } : r)
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
      x: 200 - pan.x,
      y: 200 - pan.y,
      width: type === 'video' ? 440 : 310,
      prompt: type === 'image' ? '输入生图描述...' : '输入视频运镜指令，可使用 @图1 @图2 引用素材...',
      model: type === 'image' ? 'doubao-seedream-5-0-pro' : 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      duration: 5,
      ratio: '16:9',
      references: []
    };
    setCards(prev => [...prev, newCard]);
  };

  return (
    <div
      className="w-full h-full relative bg-[#0d0f17] overflow-hidden select-none cursor-default font-sans"
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Banner & Mode Info */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3 bg-[#161924]/90 backdrop-blur-md border border-slate-700/60 rounded-2xl px-4 py-2.5 shadow-2xl">
        <div className="p-1.5 rounded-xl bg-emerald-500/20 text-emerald-400">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-xs">Lovart 无限画布 • 多图引用与 @Prompt 工作台</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-medium">
              Seedance 2.5 全模态
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            画布每张图自带 <span className="text-amber-300 font-mono font-bold">@图N</span> 标签，视频卡片支持引入多图、指定角色（首帧/主体/场景）、并在 Prompt 中精准指代
          </p>
        </div>
      </div>

      {/* Floating Toolbar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-[#161924]/90 backdrop-blur-md border border-slate-700/60 rounded-2xl p-1.5 shadow-2xl text-slate-200">
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
          <Hand className="w-3.5 h-3.5" /> 画布平移 (中键)
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
      <div className="absolute bottom-20 right-6 z-20 flex flex-col gap-1 bg-[#161924]/90 backdrop-blur border border-slate-700/60 rounded-xl p-1 text-slate-300 shadow-xl">
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
          backgroundImage: 'radial-gradient(circle, #252a3a 1.2px, transparent 1.2px)',
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
              const startY = srcCard.y + 120;
              const endX = videoCard.x;
              const endY = videoCard.y + 150;
              const dx = (endX - startX) * 0.45;

              const midX = (startX + endX) / 2;
              const midY = (startY + endY) / 2;

              return (
                <g key={`ray-${srcCard.id}-${videoCard.id}`}>
                  {/* Glowing line */}
                  <path
                    d={`M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke="url(#rayGradient)"
                    strokeWidth="2.5"
                    strokeDasharray="6 4"
                    className="animate-[dash_20s_linear_infinite]"
                  />
                  {/* Tag label badge on curve */}
                  <g transform={`translate(${midX - 28}, ${midY - 10})`}>
                    <rect width="56" height="20" rx="10" fill="#181a24" stroke="#6366f1" strokeWidth="1.5" />
                    <text x="28" y="14" fill="#a5b4fc" fontSize="10" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">
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
            className={`absolute z-10 bg-[#161822]/95 border rounded-2xl shadow-2xl overflow-visible text-slate-200 transition-shadow ${
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

              <div className="flex items-center gap-1.5">
                {/* Global Tag Indicator (e.g. @图1) */}
                <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                  card.type === 'image'
                    ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                    : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                }`}>
                  @图{card.tagIndex}
                </span>
              </div>
            </div>

            {/* Card Body */}
            <div className="p-4 space-y-3.5">
              {/* IMAGE CARD SPECIFIC BODY */}
              {card.type === 'image' && (
                <>
                  <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-square flex items-center justify-center group">
                    <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-purple-950 to-pink-950 flex flex-col items-center justify-center p-4 text-center">
                      <ImageIcon className="w-8 h-8 text-pink-400/80 mb-2" />
                      <span className="text-xs text-pink-200 font-medium">Seedream 5.0 (2048x2048)</span>
                      <span className="text-[10px] text-slate-400 mt-1">点击可作为参考源拖入视频</span>
                    </div>
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] font-mono font-bold text-pink-300 border border-pink-500/30">
                      @图{card.tagIndex}
                    </div>
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> 已就绪
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">提示词 (Prompt)</label>
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

              {/* VIDEO CARD SPECIFIC BODY */}
              {card.type === 'video' && (
                <>
                  {/* Model & Spec Selector */}
                  <div className="flex items-center justify-between text-xs bg-[#0e1017] p-2 rounded-xl border border-slate-800">
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
                        <option value="doubao-seedance-2-5-260628">Seedance 2.5 (全模态超长)</option>
                        <option value="doubao-seedance-2-0-260128">Seedance 2.0 Pro</option>
                        <option value="MiniMax-H3">MiniMax H3 (高动态)</option>
                        <option value="video-01">MiniMax Video-01</option>
                      </select>
                    </div>
                    <span className="font-mono text-[11px] text-indigo-300">16:9 • 720p • 5s</span>
                  </div>

                  {/* Multi-Image Reference Slots (参考素材槽位) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-indigo-400" />
                        已绑定的参考素材 ({card.references?.length ?? 0}/30)
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
                        card.references.map(ref => (
                          <div
                            key={ref.cardId}
                            className="flex items-center justify-between bg-[#0e1017] border border-slate-800 p-2 rounded-xl text-xs gap-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono font-bold text-[11px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 border border-pink-500/30 flex-shrink-0">
                                @图{ref.tagIndex}
                              </span>
                              <span className="text-slate-300 text-xs truncate max-w-[130px]">{ref.label}</span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {/* Role Selector */}
                              <select
                                value={ref.role}
                                onChange={e => updateReferenceRole(card.id, ref.cardId, e.target.value as any)}
                                className="bg-slate-800 text-[10px] font-medium text-indigo-300 rounded px-1.5 py-0.5 border border-slate-700 focus:outline-none"
                              >
                                <option value="reference_image">主体参考 (reference_image)</option>
                                <option value="first_frame">首帧 (first_frame)</option>
                                <option value="last_frame">尾帧 (last_frame)</option>
                                <option value="scene_ref">场景/风格 (scene)</option>
                              </select>

                              <button
                                onClick={() => removeReference(card.id, ref.cardId)}
                                className="text-slate-500 hover:text-red-400 p-1 transition"
                                title="解除引用"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-2.5 rounded-xl border border-dashed border-slate-800 text-center text-[11px] text-slate-500">
                          暂无绑定素材，点击上方引入或在下方 Prompt 中键入 @
                        </div>
                      )}
                    </div>

                    {/* Mention Target Dropdown Picker */}
                    {mentionTargetCardId === card.id && (
                      <div className="bg-[#1c1f2e] border border-indigo-500/40 rounded-xl p-2 shadow-2xl space-y-1 animate-in fade-in">
                        <span className="text-[10px] font-semibold text-slate-400 px-1 block">选择画布上的生图素材：</span>
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
                            <span className="text-[10px] text-indigo-300 font-medium">+ 绑定</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Prompt Textarea with Inline @ Mentions */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                        <AtSign className="w-3 h-3 text-indigo-400" />
                        视频运镜指令 (Prompt，支持精确 @ 指代)
                      </label>
                    </div>
                    <textarea
                      value={card.prompt}
                      onChange={e => {
                        const val = e.target.value;
                        setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                      }}
                      className="w-full bg-[#0e1017] border border-slate-700/80 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-24 leading-relaxed font-sans"
                      placeholder="例如：以 @图1 为角色主体，在 @图2 场景中向前走动..."
                    />

                    {/* Quick Mention Insert Pills */}
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
                  </div>

                  {/* Generation Status / Output Preview */}
                  {card.status === 'generating' && (
                    <div className="space-y-1 bg-[#0e1017] p-2.5 rounded-xl border border-slate-800">
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                          火山方舟 / MiniMax 任务渲染中...
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
                        <span className="text-[10px] text-slate-400 mt-1">融合了 @图1(主体) 与 @图2(场景)</span>
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
                      <Sparkles className="w-4 h-4" /> 提交多模态视频生成
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
