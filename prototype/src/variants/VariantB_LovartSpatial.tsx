import React, { useState, useRef } from 'react';
import { Sparkles, Video, Image as ImageIcon, Plus, MousePointer, Hand, Move, ZoomIn, ZoomOut, Film, Trash2, CheckCircle2, Loader2, ArrowUpRight } from 'lucide-react';

interface SpatialCard {
  id: string;
  type: 'image' | 'video' | 'multiref';
  title: string;
  x: number;
  y: number;
  width: number;
  prompt: string;
  model: string;
  status: 'idle' | 'generating' | 'done';
  progress: number;
  refCardId?: string;
}

export const VariantB_LovartSpatial: React.FC = () => {
  const [cards, setCards] = useState<SpatialCard[]>([
    {
      id: 'card-1',
      type: 'image',
      title: 'Seedream 5.0 原画设定',
      x: 120,
      y: 140,
      width: 320,
      prompt: '超写实机甲少女，未来都市夜景，雨夜霓虹反光，Vogue 杂志风格封面',
      model: 'doubao-seedream-5-0-pro',
      status: 'done',
      progress: 100
    },
    {
      id: 'card-2',
      type: 'video',
      title: 'Seedance 2.5 运镜生成',
      x: 520,
      y: 140,
      width: 340,
      prompt: '人物抬头望向夜空，眼神灵动微变，雨丝划过面庞，镜头360度缓慢环绕',
      model: 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      refCardId: 'card-1'
    },
    {
      id: 'card-3',
      type: 'video',
      title: 'MiniMax H3 动作续写',
      x: 940,
      y: 180,
      width: 340,
      prompt: '紧接上一个镜头，少女跃向高空机甲战舰，动态模糊与粒子光效',
      model: 'MiniMax-H3',
      status: 'idle',
      progress: 0,
      refCardId: 'card-2'
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

  const handleMouseDownCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'hand' || e.button === 1 || e.target === e.currentTarget) {
      setIsPanning(true);
      startPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
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

  const addNewCard = (type: 'image' | 'video') => {
    const newCard: SpatialCard = {
      id: `card-${Date.now()}`,
      type,
      title: type === 'image' ? '新 Seedream 生图' : '新 Seedance 视频',
      x: 200 - pan.x,
      y: 200 - pan.y,
      width: 320,
      prompt: '输入新的创意构想描述...',
      model: type === 'image' ? 'doubao-seedream-5-0-pro' : 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0
    };
    setCards(prev => [...prev, newCard]);
  };

  return (
    <div
      className="w-full h-full relative bg-[#0e1017] overflow-hidden select-none cursor-default"
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Header */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3 bg-[#181a24]/90 backdrop-blur border border-slate-700/60 rounded-xl px-4 py-2 text-xs">
        <span className="font-bold text-white flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          Lovart 自由无限画布空间模式 (Spatial Board)
        </span>
        <span className="text-slate-400 border-l border-slate-700 pl-3">
          自由摆放卡片、直觉拖拽关联、沉浸式大画布创作
        </span>
      </div>

      {/* Floating Toolbar */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1 bg-[#181a24]/90 backdrop-blur border border-slate-700/60 rounded-xl p-1.5 shadow-xl text-slate-300">
        <button
          onClick={() => setActiveTool('select')}
          className={`p-2 rounded-lg text-xs flex items-center gap-1.5 transition ${activeTool === 'select' ? 'bg-indigo-600 text-white font-medium' : 'hover:bg-slate-800'}`}
        >
          <MousePointer className="w-3.5 h-3.5" /> 选择 / 移动
        </button>
        <button
          onClick={() => setActiveTool('hand')}
          className={`p-2 rounded-lg text-xs flex items-center gap-1.5 transition ${activeTool === 'hand' ? 'bg-indigo-600 text-white font-medium' : 'hover:bg-slate-800'}`}
        >
          <Hand className="w-3.5 h-3.5" /> 画布漫游
        </button>
        <div className="w-[1px] h-4 bg-slate-700 mx-1" />
        <button
          onClick={() => addNewCard('image')}
          className="p-2 rounded-lg text-xs flex items-center gap-1.5 hover:bg-pink-600/30 text-pink-300 transition"
        >
          <Plus className="w-3.5 h-3.5" /> +生图卡片
        </button>
        <button
          onClick={() => addNewCard('video')}
          className="p-2 rounded-lg text-xs flex items-center gap-1.5 hover:bg-indigo-600/30 text-indigo-300 transition"
        >
          <Plus className="w-3.5 h-3.5" /> +生视频卡片
        </button>
      </div>

      {/* Zoom Controls */}
      <div className="absolute bottom-20 right-6 z-20 flex flex-col gap-1 bg-[#181a24]/90 backdrop-blur border border-slate-700/60 rounded-xl p-1.5 text-slate-300">
        <button onClick={() => setZoom(z => Math.min(2, z + 0.15))} className="p-1.5 hover:bg-slate-800 rounded">
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="text-[10px] text-center font-mono py-0.5">{Math.round(zoom * 100)}%</div>
        <button onClick={() => setZoom(z => Math.max(0.4, z - 0.15))} className="p-1.5 hover:bg-slate-800 rounded">
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Infinite Canvas Container */}
      <div
        className="w-full h-full origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          backgroundImage: 'radial-gradient(circle, #272c3d 1px, transparent 1px)',
          backgroundSize: '24px 24px'
        }}
      >
        {/* Render Connection Lines between spatial cards */}
        <svg className="absolute top-0 left-0 w-[5000px] h-[5000px] pointer-events-none z-0">
          {cards.map(card => {
            if (!card.refCardId) return null;
            const target = cards.find(c => c.id === card.refCardId);
            if (!target) return null;
            const startX = target.x + target.width;
            const startY = target.y + 100;
            const endX = card.x;
            const endY = card.y + 100;
            const dx = (endX - startX) * 0.5;

            return (
              <path
                key={`line-${card.id}-${target.id}`}
                d={`M ${startX} ${startY} C ${startX + dx} ${startY}, ${endX - dx} ${endY}, ${endX} ${endY}`}
                fill="none"
                stroke="#6366f1"
                strokeWidth="2.5"
                strokeDasharray="6 4"
                className="opacity-70"
              />
            );
          })}
        </svg>

        {/* Cards on Spatial Canvas */}
        {cards.map(card => (
          <div
            key={card.id}
            style={{
              transform: `translate(${card.x}px, ${card.y}px)`,
              width: `${card.width}px`
            }}
            className={`absolute z-10 bg-[#191c26] border rounded-2xl shadow-2xl overflow-hidden text-slate-200 transition-shadow ${
              draggingCardId === card.id ? 'border-indigo-500 shadow-indigo-500/30 shadow-2xl scale-[1.01]' : 'border-slate-700/80 hover:border-slate-600'
            }`}
          >
            {/* Card Header (Drag Handle) */}
            <div
              onMouseDown={e => handleStartDragCard(e, card)}
              className="bg-slate-800/80 px-3.5 py-2.5 border-b border-slate-700/80 flex items-center justify-between cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-center gap-2">
                <Move className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold text-white tracking-wide">{card.title}</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900/80 text-indigo-300">
                {card.model.includes('seedance') ? 'Seedance 2.5' : card.model.includes('minimax') ? 'MiniMax H3' : 'Seedream 5.0'}
              </span>
            </div>

            {/* Card Body */}
            <div className="p-3.5 space-y-3">
              {card.refCardId && (
                <div className="p-1.5 px-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 flex items-center justify-between text-[11px] text-indigo-200">
                  <span className="flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3 text-indigo-400" /> 继承参考前序素材
                  </span>
                  <span className="font-mono text-[10px] text-indigo-400">Linked</span>
                </div>
              )}

              <textarea
                value={card.prompt}
                onChange={e => {
                  const val = e.target.value;
                  setCards(prev => prev.map(c => c.id === card.id ? { ...c, prompt: val } : c));
                }}
                className="w-full bg-[#11131a] border border-slate-700/80 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-20 leading-relaxed"
                placeholder="描述你的画面与运动要求..."
              />

              {card.status === 'generating' && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> 渲染计算中
                    </span>
                    <span className="font-mono">{card.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-300" style={{ width: `${card.progress}%` }} />
                  </div>
                </div>
              )}

              {card.status === 'done' ? (
                <div className="relative rounded-xl overflow-hidden border border-slate-700 bg-black aspect-video flex items-center justify-center group">
                  {card.type === 'image' ? (
                    <div className="w-full h-full bg-gradient-to-br from-indigo-900/60 via-purple-900/40 to-pink-900/60 flex items-center justify-center text-center p-3">
                      <span className="text-xs text-indigo-200 font-medium">✨ [Seedream 5.0 2K 产出物]</span>
                    </div>
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex flex-col items-center justify-center">
                      <Film className="w-7 h-7 text-indigo-300 mb-1" />
                      <span className="text-[10px] text-slate-400 font-mono">output_video.mp4</span>
                    </div>
                  )}
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/70 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> 就绪
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => triggerGenerate(card.id)}
                  disabled={card.status === 'generating'}
                  className="w-full py-2 bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg transition active:scale-98"
                >
                  <Sparkles className="w-3.5 h-3.5" /> 开始生成
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
