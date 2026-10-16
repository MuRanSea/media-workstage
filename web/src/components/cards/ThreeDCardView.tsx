import React, { useEffect, useMemo, useState } from 'react';
import { Box, FolderOpen, Maximize2, Sparkles, X } from 'lucide-react';
import type { TaskAssetDto } from '../../types/canvas.ts';
import { MISSING_PROVIDER_HINT, buildProviderGroups, findModelOption, isModelReady, isProviderMissing } from '../../engine/channelModels.ts';
import { NO_3D_MODELS_HINT, modelFiles, previewFile, spec3DSummary, viewLabel, viewOf } from '../../engine/model3d.ts';
import { previewAspect } from '../../engine/cardParams.ts';
import { assetStoredPath, assetUrl, getActiveProjectId } from '../../engine/assetPaths.ts';
import { apiRevealAsset } from '../../services/projects.ts';
import { useChannels } from '../../services/channels.ts';
import { Button } from '../ui/Button.tsx';
import { InputSlot, LinkedPromptBox } from './CardPorts.tsx';
import { InlineModelView } from './InlineModelView.tsx';
import { AutoTextarea, CardShell, ErrorBox, GeneratingOverlay, MediaFrame, RunsBadge, StatusChip, SummaryRow } from './CardShell.tsx';
import type { CardViewProps } from './cardProps.ts';

interface ThreeDCardViewProps extends CardViewProps {
  /** Set when a text card feeds this card's prompt. */
  linkedPrompt?: { title: string; text: string };
  onUnlinkPrompt?: () => void;
  /** Generation cards: the submit request is in flight. */
  isSubmitting?: boolean;
  /** Generation cards: result cards still queued or running. */
  runsInProgress?: number;
  onNotice: (message: string) => void;
}

/**
 * 3D Generation Card and 3D Result Card. A result holds one model in every format the run
 * produced, shown by the gateway's cover; it has no tag and no output port, since nothing
 * takes a model as input.
 */
export const ThreeDCardView: React.FC<ThreeDCardViewProps> = ({
  card,
  isSelected,
  connectHint,
  onSelect,
  onStartDrag,
  onUpdateCard,
  onTriggerGenerate,
  menuItems,
  onOpenViewer,
  linkedPrompt,
  onUnlinkPrompt,
  isSubmitting = false,
  runsInProgress = 0,
  onNotice,
}) => {
  const [loadedAspect, setLoadedAspect] = useState<number>();
  // The cover is replaced by a live, rotatable view in place while the card stays selected.
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!isSelected) setLive(false);
  }, [isSelected]);
  const channels = useChannels();
  const groups = useMemo(() => buildProviderGroups(channels, '3d'), [channels]);
  const modelLabel = (card.provider && findModelOption(groups, card.provider, card.model)?.label) || card.model || '未选择模型';
  const shell = {
    card,
    accent: 'sky' as const,
    icon: <Box className="w-4 h-4" />,
    isSelected,
    connectHint,
    onSelect,
    onStartDrag,
    onRename: (title: string) => onUpdateCard(card.id, { title }),
    menuItems,
  };

  if (card.role === 'generation') {
    const noModels = groups.length === 0;
    const missing = isProviderMissing(channels, card.provider);
    const ready = !!card.provider && !!card.model && isModelReady('3d', card.provider, card.model);
    const blocked = noModels ? NO_3D_MODELS_HINT : missing ? MISSING_PROVIDER_HINT : !ready ? '请在右侧面板选择 3D 模型' : undefined;
    return (
      <CardShell {...shell} badges={<RunsBadge count={runsInProgress} accent="sky" />}>
        <SummaryRow model={modelLabel} spec={spec3DSummary(card)} />
        <div className="relative flex items-center gap-1.5 flex-wrap text-[11px]" title="在属性面板里给每张图选视角">
          <InputSlot kind="reference" title="参考图输入：从图片或上传卡片右侧的圆点拖线到这张卡片" />
          <span className="text-slate-500">参考图</span>
          {card.references?.map((ref) => (
            <span key={ref.cardId} className="px-1.5 py-px rounded-md border bg-sky-500/15 text-sky-300 border-sky-500/30">
              {viewLabel(viewOf(ref))}
            </span>
          ))}
          {!card.references?.length && <span className="text-slate-600">可选，从左侧圆点连入图片</span>}
        </div>
        <div className="relative">
          <InputSlot kind="prompt" />
          {linkedPrompt ? (
            <LinkedPromptBox sourceTitle={linkedPrompt.title} text={linkedPrompt.text} onUnlink={() => onUnlinkPrompt?.()} />
          ) : (
            <AutoTextarea
              accent="sky"
              value={card.prompt}
              onChange={(e) => onUpdateCard(card.id, { prompt: e.target.value })}
              placeholder="描述要生成的物体；连了参考图时可以不写"
            />
          )}
        </div>
        {card.errorMessage && <ErrorBox message={card.errorMessage} />}
        <Button
          variant="primary"
          accent="sky"
          block
          disabled={isSubmitting || !!blocked}
          onClick={() => onTriggerGenerate(card.id)}
          icon={blocked ? undefined : <Sparkles className="w-3.5 h-3.5" />}
        >
          {blocked ?? '生成'}
        </Button>
      </CardShell>
    );
  }

  const isGenerating = card.status === 'running' || card.status === 'queued';
  const cover = assetUrl(card.resultUrl);
  const files = modelFiles(card);
  const reveal = (asset: TaskAssetDto) => {
    const projectId = getActiveProjectId();
    const path = assetStoredPath(asset);
    if (!projectId || !path) return;
    apiRevealAsset(projectId, path).catch((err: Error) => onNotice(err.message || '无法打开文件夹'));
  };
  const primary = files.find((f) => f.asset.kind === 'model3d') ?? files[0];
  const preview = previewFile(card);
  const previewUrl = preview ? assetUrl(assetStoredPath(preview)) : undefined;
  // Double-click opens the GLB/glTF in the 3D preview, or says the formats it has cannot be previewed.
  const openPreview = () => {
    const models = files.filter((f) => f.asset.kind === 'model3d');
    if (!models.length) return;
    const shown = preview ?? models[0].asset;
    onOpenViewer({
      kind: 'model3d',
      title: card.title,
      url: preview ? assetUrl(assetStoredPath(preview)) : undefined,
      formats: models.map((f) => f.format),
      onReveal: () => reveal(shown),
    });
  };

  return (
    <CardShell {...shell}>
      <MediaFrame aspect={(cover && loadedAspect) || previewAspect(card)}>
        {live && previewUrl ? (
          <>
            <InlineModelView url={previewUrl} onExit={() => setLive(false)} />
            <div className="absolute top-2 right-2 z-[2] flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                title="全屏预览"
                onClick={openPreview}
                className="p-1 rounded-md bg-black/60 text-slate-200 hover:bg-black/80 hover:text-sky-300"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title="退出交互（Esc）"
                onClick={() => setLive(false)}
                className="p-1 rounded-md bg-black/60 text-slate-200 hover:bg-black/80 hover:text-sky-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <span className="absolute bottom-2 left-2 z-[2] px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] text-slate-300 pointer-events-none">
              拖动旋转 · 滚轮缩放 · 右键平移
            </span>
          </>
        ) : (
          files.some((f) => f.asset.kind === 'model3d') && (
            <div
              className="absolute inset-0 z-[1] cursor-pointer"
              title={preview ? '双击在卡片内旋转预览' : '双击查看文件'}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (previewUrl) setLive(true);
                else openPreview();
              }}
            >
              <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md bg-black/60 text-[10px] text-slate-200 opacity-0 group-hover:opacity-100 transition">
                {preview ? '双击旋转预览' : '双击查看'}
              </span>
            </div>
          )
        )}
        {cover ? (
          <img
            src={cover}
            alt={card.title}
            decoding="async"
            className="w-full h-full object-contain"
            onLoad={(e) => setLoadedAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
            onError={(e) => ((e.target as HTMLElement).style.visibility = 'hidden')}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-sky-950/30 via-slate-900 to-slate-950 text-center">
            <Box className="w-6 h-6 text-sky-400/60" />
            <span className="text-[11px] text-slate-500">{card.status === 'succeeded' ? '没有封面图' : '等待生成结果'}</span>
          </div>
        )}
        <StatusChip status={card.status} />
        {isGenerating && <GeneratingOverlay progress={card.progress} />}
      </MediaFrame>

      <SummaryRow model={modelLabel} spec={spec3DSummary(card)} />

      {files.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {files.map(({ format, asset }) => (
            <button
              key={asset.id || asset.local_path}
              type="button"
              title={`在文件夹中显示 ${format} 文件`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => reveal(asset)}
              className="font-mono text-[11px] px-1.5 py-px rounded-md border bg-sky-500/15 text-sky-300 border-sky-500/30 hover:border-sky-400"
            >
              {format}
            </button>
          ))}
          {primary && (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => reveal(primary.asset)}
              className="ml-auto flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-300"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              在文件夹中显示
            </button>
          )}
        </div>
      )}

      {card.errorMessage && <ErrorBox message={card.errorMessage} />}
    </CardShell>
  );
};
