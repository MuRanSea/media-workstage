import React, { useState, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
  NodeProps,
  BackgroundVariant
} from '@xyflow/react';
import { Sparkles, Video, Image as ImageIcon, Play, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';

// Custom Image Node (Seedream 5.0)
const ImageNode: React.FC<NodeProps> = ({ data, isConnectable }) => {
  const [prompt, setPrompt] = useState('赛博朋克雨夜街道，霓虹灯倒影，电影质感 8K');
  const [status, setStatus] = useState<'idle' | 'running' | 'success'>('idle');
  const [progress, setProgress] = useState(0);

  const handleGenerate = () => {
    setStatus('running');
    setProgress(15);
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 95) {
          clearInterval(interval);
          setStatus('success');
          return 100;
        }
        return p + 20;
      });
    }, 400);
  };

  return (
    <div className="w-[320px] bg-[#1a1d26] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden text-slate-200">
      <div className="bg-slate-800/80 px-3.5 py-2.5 border-b border-slate-700/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-pink-400" />
          <span className="text-xs font-bold tracking-wide text-white">Seedream 5.0 生图</span>
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300 font-medium">
          Ark Native
        </span>
      </div>

      <div className="p-3.5 space-y-3">
        <div>
          <label className="text-[11px] font-medium text-slate-400 block mb-1">提示词 (Prompt)</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            className="w-full bg-[#11131a] border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-16"
          />
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">分辨率</span>
          <span className="px-2 py-0.5 rounded bg-slate-800 font-mono text-[11px] text-slate-300">2K (2048x2048)</span>
        </div>

        {status === 'running' && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin text-indigo-400" /> 生成中...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {status === 'success' ? (
          <div className="relative rounded-lg overflow-hidden border border-slate-700 bg-black aspect-video flex items-center justify-center group">
            <div className="w-full h-full bg-gradient-to-br from-indigo-900/60 via-purple-900/40 to-pink-900/60 flex items-center justify-center p-4 text-center">
              <span className="text-xs text-indigo-200 font-medium">✨ [Seedream 5.0 生成图 2048x2048]</span>
            </div>
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> 完成
            </div>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={status === 'running'}
            className="w-full py-2 px-3 bg-gradient-to-r from-pink-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-500/20 transition active:scale-98"
          >
            <Sparkles className="w-3.5 h-3.5" /> 生成图片
          </button>
        )}
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-pink-500 !border-2 !border-[#1a1d26] hover:scale-125 transition"
      />
    </div>
  );
};

// Custom Video Node (Seedance 2.5 / MiniMax H3)
const VideoNode: React.FC<NodeProps> = ({ data, isConnectable }) => {
  const [model, setModel] = useState<'seedance2.5' | 'minimax-h3'>('seedance2.5');
  const [prompt, setPrompt] = useState('镜头缓慢推进，雨滴滑落，赛博光影流转 --rt 16:9');
  const [status, setStatus] = useState<'idle' | 'running' | 'success'>('idle');
  const [progress, setProgress] = useState(0);

  const handleGenerate = () => {
    setStatus('running');
    setProgress(10);
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 95) {
          clearInterval(interval);
          setStatus('success');
          return 100;
        }
        return p + 15;
      });
    }, 600);
  };

  return (
    <div className="w-[340px] bg-[#1a1d26] border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden text-slate-200">
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="ref-image"
        isConnectable={isConnectable}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-[#1a1d26] hover:scale-125 transition"
      />

      <div className="bg-slate-800/80 px-3.5 py-2.5 border-b border-slate-700/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold tracking-wide text-white">视频生成工作流</span>
        </div>
        <select
          value={model}
          onChange={e => setModel(e.target.value as any)}
          className="bg-[#11131a] border border-slate-700 text-[11px] rounded px-2 py-0.5 text-indigo-300 font-medium focus:outline-none"
        >
          <option value="seedance2.5">Seedance 2.5</option>
          <option value="minimax-h3">MiniMax H3</option>
        </select>
      </div>

      <div className="p-3.5 space-y-3">
        <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center justify-between text-xs">
          <span className="text-slate-400">参考首帧</span>
          <span className="text-indigo-400 font-mono text-[11px] flex items-center gap-1">
            <ArrowRight className="w-3 h-3" /> 已连接前置图
          </span>
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-400 block mb-1">视频提示词 / 运镜指令</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            className="w-full bg-[#11131a] border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-16"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-[#11131a] p-2 rounded border border-slate-800">
            <span className="text-slate-400 block text-[10px]">时长</span>
            <span className="text-slate-200 font-mono">5 秒 (120 帧)</span>
          </div>
          <div className="bg-[#11131a] p-2 rounded border border-slate-800">
            <span className="text-slate-400 block text-[10px]">分辨率</span>
            <span className="text-slate-200 font-mono">720p (16:9)</span>
          </div>
        </div>

        {status === 'running' && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin text-indigo-400" /> 云端渲染轮询中...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {status === 'success' ? (
          <div className="relative rounded-lg overflow-hidden border border-slate-700 bg-black aspect-video flex items-center justify-center">
            <div className="w-full h-full bg-gradient-to-br from-indigo-950 via-slate-900 to-cyan-950 flex flex-col items-center justify-center p-4">
              <Play className="w-8 h-8 text-white/80 mb-1" />
              <span className="text-[11px] text-indigo-200 font-mono">seedance_gen_001.mp4</span>
            </div>
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-[10px] text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> 渲染就绪
            </div>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={status === 'running'}
            className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/30 transition active:scale-98"
          >
            <Play className="w-3.5 h-3.5 fill-current" /> 提交视频生成任务
          </button>
        )}
      </div>
    </div>
  );
};

const nodeTypes = {
  imageNode: ImageNode,
  videoNode: VideoNode
};

const initialNodes = [
  {
    id: '1',
    type: 'imageNode',
    position: { x: 100, y: 150 },
    data: { label: 'Seedream 5.0' }
  },
  {
    id: '2',
    type: 'videoNode',
    position: { x: 520, y: 150 },
    data: { label: 'Video Gen' }
  }
];

const initialEdges = [
  {
    id: 'e1-2',
    source: '1',
    target: '2',
    sourceHandle: 'image-out',
    targetHandle: 'ref-image',
    animated: true,
    style: { stroke: '#818cf8', strokeWidth: 2 }
  }
];

export const VariantA_ReactFlow: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: any) => setEdges(eds => addEdge({ ...params, animated: true, style: { stroke: '#818cf8', strokeWidth: 2 } }, eds)),
    [setEdges]
  );

  return (
    <div className="w-full h-full relative bg-[#0d0f15]">
      {/* Top Header */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-[#181a24]/90 backdrop-blur border border-slate-700/60 rounded-xl px-4 py-2 text-xs">
        <span className="font-bold text-white flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          DAG 管道连线工作流模式 (React Flow)
        </span>
        <span className="text-slate-400 border-l border-slate-700 pl-3">
          支持节点连线传递首尾帧、参数流转与执行管道
        </span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Controls className="!bg-[#1a1d26] !border-slate-700 !text-white" />
        <MiniMap
          className="!bg-[#11131a] !border-slate-800"
          nodeColor={() => '#4f46e5'}
        />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2b3040" />
      </ReactFlow>
    </div>
  );
};
