import React, { useMemo, useState, useRef } from 'react';
import {
  Film,
  Settings2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Code,
  Layers,
  Volume2,
  X,
  Sparkles,
  Plus,
  Hash,
  AtSign,
} from 'lucide-react';
import {
  type SpatialCard,
  type ReferenceItem,
  type VideoTaskMode,
  resolveVideoModelDef,
} from '../../types/canvas.ts';
import { compileCardVideoPayload, inferVideoProvider } from '../../engine/videoCompiler.ts';
import {
  buildProviderGroups,
  findModelOption,
  isModelReady,
  type ModelOption,
} from '../../engine/channelModels.ts';
import { useChannels } from '../../services/channels.ts';
import { ProviderModelPicker } from './ProviderModelPicker.tsx';
import { InputPort, LinkedPromptBox, connectHintRing, type ConnectHint } from './CardPorts.tsx';
import { assetUrl } from '../../engine/assetPaths.ts';

interface VideoCardViewProps {
  card: SpatialCard;
  isSelected: boolean;
  availableImageCards: SpatialCard[];
  onUpdateCard: (cardId: string, updater: Partial<SpatialCard>) => void;
  onDeleteCard: (cardId: string) => void;
  onStartDrag: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTriggerGenerate: (cardId: string) => void;
  /** Set when a text card feeds this card's prompt. */
  linkedPrompt?: { title: string; text: string };
  onUnlinkPrompt?: () => void;
  connectHint?: ConnectHint;
}

export const VideoCardView: React.FC<VideoCardViewProps> = ({
  card,
  isSelected,
  availableImageCards,
  onUpdateCard,
  onDeleteCard,
  onStartDrag,
  onTriggerGenerate,
  linkedPrompt,
  onUnlinkPrompt,
  connectHint,
}) => {
  const [openMentionPicker, setOpenMentionPicker] = useState(false);
  const [showJsonInspector, setShowJsonInspector] = useState(false);

  // Typing @ mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCursorPos, setMentionCursorPos] = useState<number>(0);

  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);

  const channels = useChannels();
  const providerGroups = useMemo(() => buildProviderGroups(channels, 'video'), [channels]);
  const provider = card.provider ?? inferVideoProvider(card.model);
  const currentModel = resolveVideoModelDef(provider, card.model);
  const currentOption = findModelOption(providerGroups, provider, card.model);
  const canGenerate = isModelReady('video', provider, card.model);
  const supportsMode = (m: VideoTaskMode) => !currentModel.modes || currentModel.modes.includes(m);

  // Mode switch: drop or re-role references to fit the mode and the model's limit.
  const modeUpdate = (newMode: VideoTaskMode, maxRefs: number, ratio = card.ratio): Partial<SpatialCard> => {
    let newRefs = (card.references ?? []).slice(0, maxRefs);
    let newRatio = ratio;

    if (newMode === 'text_to_video') {
      newRefs = [];
    } else if (newMode === 'first_last_frame') {
      newRefs = newRefs.slice(0, 2).map((r, idx) => ({
        ...r,
        role: idx === 0 ? 'first_frame' : 'last_frame',
      }));
      newRatio = 'adaptive';
    } else if (newMode === 'all_modal') {
      newRefs = newRefs.map((r) => ({ ...r, role: 'reference_image' }));
    }
    return { mode: newMode, ratio: newRatio, references: newRefs };
  };

  const selectModel = (option: ModelOption) => {
    const modelDef = resolveVideoModelDef(option.provider, option.id);
    const current = card.mode ?? 'all_modal';
    let mode = current;
    if (modelDef.modes && !modelDef.modes.includes(current)) {
      // Keep attached images as frames when possible; otherwise fall back to text-to-video.
      const hasRefs = (card.references?.length ?? 0) > 0;
      const preferred: VideoTaskMode = hasRefs ? 'first_last_frame' : 'text_to_video';
      mode = modelDef.modes.includes(preferred) ? preferred : modelDef.modes[0];
    }
    onUpdateCard(card.id, {
      provider: option.provider,
      model: option.id,
      resolution: modelDef.resolutions[0],
      duration: modelDef.durations.includes(5) ? 5 : modelDef.durations[0],
      ...modeUpdate(mode, modelDef.maxRefs, modelDef.ratios[0]),
    });
  };

  const setTaskMode = (newMode: VideoTaskMode) => {
    onUpdateCard(card.id, modeUpdate(newMode, currentModel.maxRefs));
  };

  const attachReference = (imageCard: SpatialCard) => {
    const currentMode = card.mode ?? 'all_modal';
    if (currentMode === 'text_to_video') return;

    const maxRefs = currentModel.maxRefs;
    const currentRefs = card.references ?? [];
    if (currentRefs.length >= maxRefs) return;
    if (currentRefs.some((r) => r.cardId === imageCard.id)) return;
    if (currentMode === 'first_last_frame' && currentRefs.length >= 2) return;
    const role: ReferenceItem['role'] =
      currentMode === 'first_last_frame'
        ? currentRefs.length === 0
          ? 'first_frame'
          : 'last_frame'
        : 'reference_image';

    const newRef: ReferenceItem = {
      cardId: imageCard.id,
      tagIndex: imageCard.tagIndex,
      role,
      label: imageCard.title.slice(0, 10),
      url: imageCard.resultUrl,
    };

    const tagStr = `@图${imageCard.tagIndex}`;
    const newPrompt = card.prompt.includes(tagStr)
      ? card.prompt
      : `${card.prompt} ${tagStr}`.trim();

    onUpdateCard(card.id, {
      prompt: newPrompt,
      references: [...currentRefs, newRef],
    });
    setOpenMentionPicker(false);
  };

  const removeReference = (refCardId: string) => {
    const targetRef = card.references?.find((r) => r.cardId === refCardId);
    const newRefs = (card.references ?? []).filter((r) => r.cardId !== refCardId);
    let newPrompt = card.prompt;
    if (targetRef) {
      newPrompt = newPrompt
        .replace(new RegExp(`@图${targetRef.tagIndex}\\b`, 'g'), '')
        .trim();
    }

    onUpdateCard(card.id, {
      prompt: newPrompt,
      references: newRefs,
    });
  };

  const insertTagIntoPrompt = (tagIndex: number) => {
    const tagStr = `@图${tagIndex}`;
    const textarea = promptInputRef.current;
    if (!textarea) {
      onUpdateCard(card.id, { prompt: `${card.prompt} ${tagStr}`.trim() });
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = card.prompt;
    const nextVal =
      currentVal.substring(0, start) +
      tagStr +
      ' ' +
      currentVal.substring(end);

    onUpdateCard(card.id, { prompt: nextVal });

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tagStr.length + 1, start + tagStr.length + 1);
    }, 50);
  };

  // Handle typing @ in prompt textarea
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onUpdateCard(card.id, { prompt: val });

    if (card.mode === 'text_to_video') {
      setMentionQuery(null);
      return;
    }

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.substring(0, cursor);
    const match = textBeforeCursor.match(/@([^\s@]*)$/);

    if (match) {
      setMentionQuery(match[1]);
      setMentionCursorPos(cursor);
    } else {
      setMentionQuery(null);
    }
  };

  const handleSelectMention = (img: SpatialCard) => {
    const text = card.prompt;
    const before = text
      .substring(0, mentionCursorPos)
      .replace(/@([^\s@]*)$/, `@图${img.tagIndex} `);
    const after = text.substring(mentionCursorPos);
    const newPrompt = before + after;

    attachReference(img);
    onUpdateCard(card.id, { prompt: newPrompt });
    setMentionQuery(null);

    setTimeout(() => {
      promptInputRef.current?.focus();
    }, 50);
  };

  const getCompiledJson = () => {
    try {
      return compileCardVideoPayload(
        linkedPrompt?.text ? { ...card, prompt: linkedPrompt.text } : card,
        availableImageCards
      );
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

  const isGenerating = card.status === 'running' || card.status === 'queued';
  const videoUrl = card.resultUrl;

  const filteredMentions =
    mentionQuery !== null
      ? availableImageCards.filter((img) =>
          mentionQuery === '' ||
          `图${img.tagIndex}`.includes(mentionQuery) ||
          img.title.toLowerCase().includes(mentionQuery.toLowerCase())
        )
      : [];

  return (
    <div
      data-card-id={card.id}
      style={{
        transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
        width: `${card.width}px`,
      }}
      className={`absolute top-0 left-0 rounded-2xl bg-[#12141e]/95 backdrop-blur-xl border transition-all duration-75 select-none shadow-2xl ${
        connectHint
          ? connectHintRing(connectHint)
          : isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-500/40 shadow-indigo-500/25'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
    >
      <InputPort />
      {/* Header bar (Drag Handle) */}
      <div
        onMouseDown={onStartDrag}
        className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 cursor-grab active:cursor-grabbing bg-slate-900/40 rounded-t-2xl"
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
            <Film className="w-3 h-3 text-indigo-400" />
          </div>
          <input
            type="text"
            value={card.title}
            onChange={(e) => onUpdateCard(card.id, { title: e.target.value })}
            className="text-xs font-bold text-slate-100 bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-500/50 rounded px-1 max-w-[200px]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/40">
            @图{card.tagIndex}
          </span>
          <button
            type="button"
            onClick={() => setShowJsonInspector(!showJsonInspector)}
            title="查看编译 JSON Payload"
            className="p-1 text-slate-400 hover:text-white rounded transition"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteCard(card.id);
            }}
            title="删除卡片"
            className="p-1 text-slate-500 hover:text-red-400 rounded transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* JSON Inspector modal */}
      {showJsonInspector && (
        <div className="p-2.5 bg-black/90 border-b border-slate-800 text-[10px] font-mono text-cyan-300 max-h-48 overflow-auto">
          <pre>{JSON.stringify(getCompiledJson(), null, 2)}</pre>
        </div>
      )}

      {/* Main card body */}
      <div className="p-3 space-y-2.5">
        {/* Visual Preview Container / In-Card Video Player */}
        <div className="relative rounded-xl overflow-hidden border border-slate-700/80 bg-black aspect-video flex items-center justify-center group">
          {videoUrl ? (
            <video
              src={assetUrl(videoUrl)}
              autoPlay
              loop
              muted
              playsInline
              controls
              className="w-full h-full object-cover rounded-xl"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-indigo-950/40 via-slate-900 to-cyan-950/40 flex flex-col items-center justify-center p-3 text-center">
              <Film className="w-6 h-6 text-indigo-400 mb-1 opacity-70" />
              <span className="text-xs text-indigo-200 font-semibold">
                {currentModel.name}
              </span>
              <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                {card.resolution} • {card.duration}s • {card.ratio} •{' '}
                {card.references?.length ?? 0} 素材
              </span>
            </div>
          )}

          {/* Badge top-left */}
          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] font-mono font-bold text-indigo-300 border border-indigo-500/30 pointer-events-none">
            @图{card.tagIndex}
          </div>

          {/* Status badge top-right */}
          {card.status === 'succeeded' && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] text-emerald-400 flex items-center gap-1 border border-emerald-500/30 pointer-events-none">
              <CheckCircle2 className="w-2.5 h-2.5" /> 已完成
            </div>
          )}

          {card.status === 'failed' && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-red-950/80 backdrop-blur text-[9px] text-red-300 flex items-center gap-1 border border-red-500/40 pointer-events-none">
              <AlertCircle className="w-2.5 h-2.5" /> 失败
            </div>
          )}
        </div>

        {/* Provider → model picker: who generates this card */}
        <ProviderModelPicker
          groups={providerGroups}
          provider={provider}
          model={card.model}
          modelLabel={currentOption?.label ?? currentModel.name}
          accent="indigo"
          onSelect={selectModel}
        />

        {/* Spec summary & parameter drawer toggle */}
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-slate-400">
              {card.resolution} / {card.duration}s / {card.ratio}
            </span>
            {card.generateAudio && (
              <span title="音频已开启">
                <Volume2 className="w-3 h-3 text-emerald-400" />
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => onUpdateCard(card.id, { isExpanded: !card.isExpanded })}
            className={`text-[10px] font-medium flex items-center gap-1 px-2 py-0.5 rounded-lg border transition ${
              card.isExpanded
                ? 'bg-indigo-600 text-white border-indigo-500'
                : 'text-slate-400 hover:text-white bg-slate-800/80 border-slate-700'
            }`}
          >
            <Settings2 className="w-3 h-3" />
            {card.isExpanded ? '收起配置' : '展开参数'}
          </button>
        </div>

        {/* Expandable Parameter Drawer */}
        {card.isExpanded && (
          <div className="bg-[#0b0d14] border border-slate-800 p-2.5 rounded-xl space-y-2 text-xs">
            <div className="flex items-center gap-1 pb-1.5 border-b border-slate-800 text-[10px]">
              <button
                type="button"
                onClick={() => onUpdateCard(card.id, { activeParamTab: 'specs' })}
                className={`px-2 py-0.5 rounded-md font-semibold transition ${
                  card.activeParamTab === 'specs' || !card.activeParamTab
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                基础规格 (Specs)
              </button>
              <button
                type="button"
                onClick={() => onUpdateCard(card.id, { activeParamTab: 'refs' })}
                className={`px-2 py-0.5 rounded-md font-semibold transition ${
                  card.activeParamTab === 'refs'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                素材槽位 ({card.references?.length ?? 0}/{currentModel.maxRefs})
              </button>
              <button
                type="button"
                onClick={() => onUpdateCard(card.id, { activeParamTab: 'advanced' })}
                className={`px-2 py-0.5 rounded-md font-semibold transition ${
                  card.activeParamTab === 'advanced'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                高级控制 (Audio/Seed)
              </button>
            </div>

            {/* Specs Tab */}
            {(card.activeParamTab === 'specs' || !card.activeParamTab) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">模式:</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={!supportsMode('all_modal')}
                      title={supportsMode('all_modal') ? undefined : '当前模型不支持该模式'}
                      onClick={() => setTaskMode('all_modal')}
                      className={`px-2 py-0.5 rounded ${
                        !supportsMode('all_modal')
                          ? 'opacity-30 cursor-not-allowed bg-slate-800 text-slate-400'
                          : card.mode === 'all_modal'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      全模态多参考
                    </button>
                    <button
                      type="button"
                      disabled={!supportsMode('first_last_frame')}
                      title={supportsMode('first_last_frame') ? undefined : '当前模型不支持该模式'}
                      onClick={() => setTaskMode('first_last_frame')}
                      className={`px-2 py-0.5 rounded ${
                        !supportsMode('first_last_frame')
                          ? 'opacity-30 cursor-not-allowed bg-slate-800 text-slate-400'
                          : card.mode === 'first_last_frame'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      首尾帧严格
                    </button>
                    <button
                      type="button"
                      disabled={!supportsMode('text_to_video')}
                      title={supportsMode('text_to_video') ? undefined : '当前模型不支持该模式'}
                      onClick={() => setTaskMode('text_to_video')}
                      className={`px-2 py-0.5 rounded ${
                        !supportsMode('text_to_video')
                          ? 'opacity-30 cursor-not-allowed bg-slate-800 text-slate-400'
                          : card.mode === 'text_to_video'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      纯文生
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">分辨率:</span>
                  <div className="flex gap-1">
                    {currentModel.resolutions.map((res) => (
                      <button
                        key={res}
                        type="button"
                        onClick={() => onUpdateCard(card.id, { resolution: res })}
                        className={`px-2 py-0.5 rounded font-mono font-bold ${
                          card.resolution === res
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {res}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">时长:</span>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {currentModel.durations.map((dur) => (
                      <button
                        key={dur}
                        type="button"
                        onClick={() => onUpdateCard(card.id, { duration: dur })}
                        className={`px-2 py-0.5 rounded font-mono font-bold ${
                          card.duration === dur
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-800 text-slate-400'
                        }`}
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
                      currentModel.ratios.map((rt) => (
                        <button
                          key={rt}
                          type="button"
                          onClick={() => onUpdateCard(card.id, { ratio: rt })}
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${
                            card.ratio === rt
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {rt}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Refs Tab */}
            {card.activeParamTab === 'refs' && (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-slate-400">已绑定素材列表:</span>
                  <button
                    type="button"
                    onClick={() => setOpenMentionPicker(!openMentionPicker)}
                    className="text-indigo-400 hover:text-indigo-300 font-medium px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>引入画布图片</span>
                  </button>
                </div>

                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {card.references && card.references.length > 0 ? (
                    card.references.map((ref) => (
                      <div
                        key={ref.cardId}
                        className="flex items-center justify-between bg-[#141722] border border-slate-800 px-2 py-1 rounded text-[10px]"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-pink-400">
                            @图{ref.tagIndex}
                          </span>
                          <span className="text-slate-300 truncate max-w-[140px]">
                            {ref.label}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeReference(ref.cardId)}
                          className="text-slate-500 hover:text-red-400 ml-2"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-slate-500 text-center py-2">
                      暂未引入参考图片
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Advanced Tab (Audio, Format, Optimizer, Seed) */}
            {card.activeParamTab === 'advanced' && (
              <div className="space-y-2 text-[10px]">
                {/* Seed Input */}
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Hash className="w-3 h-3 text-indigo-400" /> 随机种子 (Seed):
                  </span>
                  <input
                    type="number"
                    value={card.seed ?? -1}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      const num = parseInt(val, 10);
                      onUpdateCard(card.id, {
                        seed: isNaN(num) ? -1 : num,
                      });
                    }}
                    className="w-24 bg-[#161822] border border-slate-700 rounded-lg px-2 py-0.5 text-[10px] font-mono text-indigo-300 focus:outline-none focus:border-indigo-500 text-right"
                    placeholder="-1 随机"
                  />
                </div>

                {currentModel.supportsAudio && (
                  <div className="flex justify-between items-center pt-1 border-t border-slate-800/80">
                    <span className="text-slate-400">原生音频生成:</span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCard(card.id, {
                          generateAudio: !card.generateAudio,
                        })
                      }
                      className={`px-2 py-0.5 rounded border ${
                        card.generateAudio
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {card.generateAudio ? '开启自动配音' : '静音模式'}
                    </button>
                  </div>
                )}

                {currentModel.supportsMov && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">封装格式:</span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCard(card.id, {
                          outputFormat:
                            card.outputFormat === 'mov' ? 'mp4' : 'mov',
                        })
                      }
                      className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono font-bold"
                    >
                      {card.outputFormat?.toUpperCase() ?? 'MP4'}
                    </button>
                  </div>
                )}

                {provider === 'minimax' && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Prompt 智能优化器:</span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCard(card.id, {
                          promptOptimizer: !card.promptOptimizer,
                        })
                      }
                      className={`px-2 py-0.5 rounded border ${
                        card.promptOptimizer
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {card.promptOptimizer ? '已开启' : '关闭'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* References quick pills bar & insertion */}
        {card.mode !== 'text_to_video' && (
          <div className="flex items-center justify-between bg-[#0b0d14] px-2 py-1 rounded-xl border border-slate-800 text-xs">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-indigo-400" /> 素材:
              </span>
              {card.references && card.references.length > 0 ? (
                card.references.map((ref) => (
                  <button
                    key={ref.cardId}
                    type="button"
                    onClick={() => insertTagIntoPrompt(ref.tagIndex)}
                    title={`点击插入 @图${ref.tagIndex} 到提示词`}
                    className="inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-300 hover:bg-pink-500/30 border border-pink-500/30 transition active:scale-95"
                  >
                    @图{ref.tagIndex}
                  </button>
                ))
              ) : (
                <span className="text-[10px] text-slate-500">无绑定素材</span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setOpenMentionPicker(!openMentionPicker)}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 font-medium px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 flex-shrink-0"
            >
              + 引入
            </button>
          </div>
        )}

        {/* Mention picker dropdown */}
        {openMentionPicker && (
          <div className="bg-[#161925] border border-indigo-500/40 rounded-xl p-1.5 shadow-2xl z-30 space-y-1">
            <span className="text-[9px] font-semibold text-slate-400 px-1 block">
              选择画布生图素材：
            </span>
            {availableImageCards.length > 0 ? (
              availableImageCards.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => attachReference(img)}
                  className="w-full text-left px-2 py-1 rounded-lg hover:bg-indigo-600/30 flex items-center justify-between text-xs transition"
                >
                  <span className="font-mono text-pink-400 text-[10px]">
                    @图{img.tagIndex} {img.title}
                  </span>
                  <span className="text-[9px] text-indigo-300 font-semibold">+ 绑定</span>
                </button>
              ))
            ) : (
              <span className="text-[10px] text-slate-500 px-2 py-1 block">
                画布暂无生图卡片
              </span>
            )}
          </div>
        )}

        {/* Prompt input container with @ typing popup, or the connected text card's output */}
        {linkedPrompt ? (
          <LinkedPromptBox
            sourceTitle={linkedPrompt.title}
            text={linkedPrompt.text}
            onUnlink={() => onUnlinkPrompt?.()}
          />
        ) : (
        <div className="relative">
          <textarea
            ref={promptInputRef}
            value={card.prompt}
            onChange={handlePromptChange}
            className="w-full bg-[#0b0d14] border border-slate-700/70 rounded-xl p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-16 leading-relaxed"
            placeholder="运镜描述，键入 @ 快速补全引用素材..."
          />

          {/* Typing @ Inline Autocomplete Popup */}
          {mentionQuery !== null && (
            <div className="absolute bottom-full left-0 mb-1.5 w-64 bg-[#161925]/95 backdrop-blur-md border border-indigo-500/50 rounded-xl p-1.5 shadow-2xl z-40 space-y-1 animate-in fade-in">
              <div className="flex items-center gap-1 text-[9px] font-semibold text-indigo-300 px-1 pb-1 border-b border-slate-800">
                <AtSign className="w-3 h-3" />
                <span>选择要引用的画布素材：</span>
              </div>
              {filteredMentions.length > 0 ? (
                filteredMentions.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => handleSelectMention(img)}
                    className="w-full text-left px-2 py-1 rounded-lg hover:bg-indigo-600/30 flex items-center justify-between text-xs transition"
                  >
                    <span className="font-mono text-pink-400 text-[10px] font-bold">
                      @图{img.tagIndex}
                    </span>
                    <span className="text-slate-300 truncate max-w-[120px] text-[10px]">
                      {img.title}
                    </span>
                  </button>
                ))
              ) : (
                <div className="text-[10px] text-slate-500 text-center py-1">
                  未匹配到生图卡片
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* Error message display if failed */}
        {card.errorMessage && (
          <div className="p-1.5 px-2 bg-red-950/60 border border-red-500/40 rounded-lg text-[10px] text-red-300 truncate">
            {card.errorMessage}
          </div>
        )}

        {/* Trigger generate button */}
        <button
          type="button"
          onClick={() => onTriggerGenerate(card.id)}
          disabled={isGenerating || !canGenerate}
          className="w-full py-2 bg-gradient-to-r from-pink-600 via-indigo-600 to-cyan-600 hover:from-pink-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/25 transition active:scale-98 disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 渲染中 {card.progress}%
            </>
          ) : !canGenerate ? (
            <>该模型尚未接入视频生成</>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" /> 生成 {currentOption?.label ?? currentModel.name} 视频
            </>
          )}
        </button>
      </div>
    </div>
  );
};
