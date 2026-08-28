import React, { useState } from 'react';
import { Film, Sparkles, Plus, Play, Clapperboard, Settings2, Sliders, CheckCircle2, Clock, Layers, ArrowRight } from 'lucide-react';

interface ShotItem {
  id: string;
  shotNumber: number;
  title: string;
  prompt: string;
  model: string;
  duration: number;
  status: 'done' | 'rendering' | 'pending';
  thumbnailColor: string;
}

export const VariantC_StoryboardHybrid: React.FC = () => {
  const [shots, setShots] = useState<ShotItem[]>([
    {
      id: 'shot-1',
      shotNumber: 1,
      title: '镜头 1: 概念起幅 (Seedream 5.0)',
      prompt: '晨雾中的未来神殿全景，金色阳光破云而出，宏大史诗感',
      model: 'Seedream 5.0 Pro',
      duration: 5,
      status: 'done',
      thumbnailColor: 'from-amber-900/60 to-orange-950/60'
    },
    {
      id: 'shot-2',
      shotNumber: 2,
      title: '镜头 2: 主体推进 (Seedance 2.5)',
      prompt: '以镜头1为首帧，摄影机快速俯冲穿过神殿柱廊，光影快速交替',
      model: 'Seedance 2.5',
      duration: 6,
      status: 'done',
      thumbnailColor: 'from-indigo-900/60 to-purple-950/60'
    },
    {
      id: 'shot-3',
      shotNumber: 3,
      title: '镜头 3: 角色动作 (MiniMax H3)',
      prompt: '神殿中心守护者转身拔剑，剑身符文光芒暴涨，超清特效',
      model: 'MiniMax-H3',
      duration: 8,
      status: 'rendering',
      thumbnailColor: 'from-cyan-900/60 to-blue-950/60'
    }
  ]);

  const [selectedShotId, setSelectedShotId] = useState<string>('shot-2');
  const selectedShot = shots.find(s => s.id === selectedShotId) ?? shots[0];

  const addNewShot = () => {
    const nextNum = shots.length + 1;
    const newShot: ShotItem = {
      id: `shot-${Date.now()}`,
      shotNumber: nextNum,
      title: `镜头 ${nextNum}: 剧情延续`,
      prompt: '描述后续镜头的动作与环境流转...',
      model: 'Seedance 2.5',
      duration: 5,
      status: 'pending',
      thumbnailColor: 'from-slate-800 to-slate-900'
    };
    setShots(prev => [...prev, newShot]);
    setSelectedShotId(newShot.id);
  };

  return (
    <div className="w-full h-full relative bg-[#0b0d13] text-slate-200 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 bg-[#141722] border-b border-slate-800 px-5 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
            <Clapperboard className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white flex items-center gap-2">
              故事板与连续分镜工作流模式 (Storyboard & Hybrid Inspector)
            </h1>
            <p className="text-[11px] text-slate-400">
              适用于短剧/广告连续分镜创作：中央多轨舞台预览 + 底部镜头轴 + 右侧精细控制台
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center gap-1.5 shadow-lg shadow-indigo-600/30 transition">
            <Play className="w-3.5 h-3.5 fill-current" /> 连续播放成片 (19s)
          </button>
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Central Visual Staging Canvas */}
        <div className="flex-1 bg-[#0e1017] p-8 flex items-center justify-center relative overflow-hidden"
             style={{ backgroundImage: 'radial-gradient(circle, #222634 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
          
          <div className="w-[720px] bg-[#161924] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Monitor Header */}
            <div className="px-4 py-2.5 bg-slate-800/60 border-b border-slate-700/80 flex items-center justify-between text-xs">
              <span className="font-semibold text-white flex items-center gap-2">
                <Film className="w-4 h-4 text-amber-400" />
                当前选定视口：{selectedShot.title}
              </span>
              <span className="font-mono text-[11px] text-slate-400">16:9 • 1080p • {selectedShot.duration}s</span>
            </div>

            {/* Video Preview Canvas */}
            <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden group">
              <div className={`w-full h-full bg-gradient-to-br ${selectedShot.thumbnailColor} flex flex-col items-center justify-center p-6 text-center`}>
                <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center mb-3 group-hover:scale-110 transition">
                  <Play className="w-6 h-6 text-white fill-white ml-0.5" />
                </div>
                <span className="text-sm font-semibold text-white max-w-md">{selectedShot.prompt}</span>
                <span className="text-xs text-slate-400 mt-2 font-mono">{selectedShot.model} 渲染产物</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Inspector Sidebar */}
        <div className="w-80 bg-[#131620] border-l border-slate-800 p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800 text-xs font-bold text-white">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>分镜参数控制台 (Inspector)</span>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <label className="text-slate-400 text-[11px] block mb-1">模型引擎</label>
              <select
                value={selectedShot.model}
                onChange={e => {
                  const val = e.target.value;
                  setShots(prev => prev.map(s => s.id === selectedShot.id ? { ...s, model: val } : s));
                }}
                className="w-full bg-[#0c0e14] border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="Seedance 2.5">Doubao Seedance 2.5</option>
                <option value="MiniMax-H3">MiniMax H3</option>
                <option value="Seedream 5.0 Pro">Doubao Seedream 5.0 Pro</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 text-[11px] block mb-1">镜头分镜描述 (Prompt)</label>
              <textarea
                value={selectedShot.prompt}
                onChange={e => {
                  const val = e.target.value;
                  setShots(prev => prev.map(s => s.id === selectedShot.id ? { ...s, prompt: val } : s));
                }}
                className="w-full bg-[#0c0e14] border border-slate-700 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none h-24"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-slate-400 text-[11px] block mb-1">时长</label>
                <input
                  type="number"
                  value={selectedShot.duration}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setShots(prev => prev.map(s => s.id === selectedShot.id ? { ...s, duration: val } : s));
                  }}
                  className="w-full bg-[#0c0e14] border border-slate-700 rounded-lg p-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="text-slate-400 text-[11px] block mb-1">画面比例</label>
                <select className="w-full bg-[#0c0e14] border border-slate-700 rounded-lg p-2 text-xs text-white">
                  <option>16:9 (横屏)</option>
                  <option>9:16 (竖屏)</option>
                </select>
              </div>
            </div>

            <button className="w-full py-2.5 mt-2 bg-gradient-to-r from-amber-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 shadow-lg transition active:scale-98">
              <Sparkles className="w-4 h-4" /> 重新渲染此镜头
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Storyboard Sequence Tray */}
      <div className="h-44 bg-[#141722] border-t border-slate-800 p-3 px-6 flex flex-col gap-2 z-10 pb-16">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-300">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>镜头序列轨 (Timeline Storyboard)</span>
            <span className="text-[11px] text-slate-500">• 拖拽重排镜头</span>
          </div>
          <button
            onClick={addNewShot}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 transition"
          >
            <Plus className="w-3.5 h-3.5" /> 添加新镜头
          </button>
        </div>

        {/* Storyboard Reel */}
        <div className="flex items-center gap-3 overflow-x-auto py-1">
          {shots.map((shot, idx) => (
            <React.Fragment key={shot.id}>
              <div
                onClick={() => setSelectedShotId(shot.id)}
                className={`flex-shrink-0 w-52 h-24 rounded-xl border p-2 flex flex-col justify-between cursor-pointer transition ${
                  selectedShotId === shot.id
                    ? 'bg-[#1e2333] border-indigo-500 ring-2 ring-indigo-500/30'
                    : 'bg-[#10121a] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white truncate max-w-[120px]">
                    {shot.title}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-slate-300">
                    {shot.duration}s
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 line-clamp-1">{shot.prompt}</p>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-indigo-400">{shot.model}</span>
                  {shot.status === 'done' ? (
                    <span className="text-emerald-400 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> 就绪</span>
                  ) : (
                    <span className="text-amber-400 flex items-center gap-0.5"><Clock className="w-3 h-3" /> 渲染中</span>
                  )}
                </div>
              </div>

              {idx < shots.length - 1 && (
                <ArrowRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
};
