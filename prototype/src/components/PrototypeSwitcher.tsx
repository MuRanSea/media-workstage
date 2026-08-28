import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Layers, Sparkles, Film } from 'lucide-react';

interface VariantInfo {
  key: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
}

interface PrototypeSwitcherProps {
  currentVariant: string;
  onVariantChange: (variant: string) => void;
}

export const VARIANTS: VariantInfo[] = [
  {
    key: 'A',
    name: 'React Flow 节点连线 (Graph Pipeline)',
    desc: '结构化 DAG，显式端口与连线流转，适合精确控制多步生成管道',
    icon: <Layers className="w-4 h-4 text-indigo-400" />
  },
  {
    key: 'B',
    name: '空间无限画布 (Spatial Canvas)',
    desc: '自由卡片漫游、全参折叠抽屉、零漂移光标定点缩放、多图流光关联',
    icon: <Sparkles className="w-4 h-4 text-emerald-400" />
  },
  {
    key: 'C',
    name: '分镜故事板与时间轴 (Storyboard Hybrid)',
    desc: '中央大屏舞台 + 底部镜头连续时间轴 + 右侧精细控制台',
    icon: <Film className="w-4 h-4 text-amber-400" />
  }
];

export const PrototypeSwitcher: React.FC<PrototypeSwitcherProps> = ({
  currentVariant,
  onVariantChange
}) => {
  const currentIndex = VARIANTS.findIndex(v => v.key === currentVariant);
  const current = VARIANTS[currentIndex] ?? VARIANTS[0];

  const handlePrev = () => {
    const nextIdx = (currentIndex - 1 + VARIANTS.length) % VARIANTS.length;
    onVariantChange(VARIANTS[nextIdx].key);
  };

  const handleNext = () => {
    const nextIdx = (currentIndex + 1) % VARIANTS.length;
    onVariantChange(VARIANTS[nextIdx].key);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center bg-[#181a24]/95 backdrop-blur-md border border-slate-700/60 shadow-2xl rounded-full p-1.5 px-3 gap-3 text-slate-200">
      <button
        onClick={handlePrev}
        className="p-1.5 rounded-full hover:bg-slate-700/60 transition active:scale-95"
        title="Previous variant (←)"
      >
        <ChevronLeft className="w-5 h-5 text-slate-400 hover:text-white" />
      </button>

      <div className="flex items-center gap-2 px-2 border-x border-slate-700/60 min-w-[280px]">
        {current.icon}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
              Variant {current.key}
            </span>
            <span className="text-sm font-medium text-white truncate max-w-[200px]">
              {current.name.split(' ')[0]}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 truncate max-w-[260px]">
            {current.desc}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {VARIANTS.map(v => (
          <button
            key={v.key}
            onClick={() => onVariantChange(v.key)}
            className={`w-7 h-7 rounded-full text-xs font-bold transition ${
              v.key === currentVariant
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {v.key}
          </button>
        ))}
      </div>

      <button
        onClick={handleNext}
        className="p-1.5 rounded-full hover:bg-slate-700/60 transition active:scale-95"
        title="Next variant (→)"
      >
        <ChevronRight className="w-5 h-5 text-slate-400 hover:text-white" />
      </button>
    </div>
  );
};
