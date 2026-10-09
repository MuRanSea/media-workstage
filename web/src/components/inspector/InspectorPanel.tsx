import React from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  FileText,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  SquareDashed,
  Upload,
  X,
} from 'lucide-react';
import type { SpatialCard } from '../../types/canvas.ts';
import type { AlignmentType } from '../../engine/layout.ts';
import { ACCENT, ACCENT_BY_CARD_TYPE, Button, IconButton, Section } from '../ui/index.ts';
import { ImageInspector } from './ImageInspector.tsx';
import { VideoInspector } from './VideoInspector.tsx';
import { TextInspector } from './TextInspector.tsx';
import { ResultSnapshotView } from './ResultSnapshotView.tsx';
import { UploadInspector } from './UploadInspector.tsx';

export const INSPECTOR_WIDTH = 320;

const TYPE_META = {
  image: { label: '图片卡片', icon: ImageIcon },
  video: { label: '视频卡片', icon: Film },
  text: { label: '文本卡片', icon: FileText },
  upload: { label: '上传卡片', icon: Upload },
} as const;

const ROLE_LABEL = { generation: '生成卡', result: '结果卡' } as const;

const ALIGN_ACTIONS: { type: AlignmentType; title: string; icon: React.ReactNode }[] = [
  { type: 'left', title: '左对齐', icon: <AlignLeft className="w-4 h-4" /> },
  { type: 'center-h', title: '水平居中', icon: <AlignCenterHorizontal className="w-4 h-4" /> },
  { type: 'right', title: '右对齐', icon: <AlignRight className="w-4 h-4" /> },
  { type: 'top', title: '顶部对齐', icon: <AlignStartVertical className="w-4 h-4" /> },
  { type: 'center-v', title: '垂直居中', icon: <AlignCenterVertical className="w-4 h-4" /> },
  { type: 'bottom', title: '底部对齐', icon: <AlignEndVertical className="w-4 h-4" /> },
];

interface InspectorPanelProps {
  selected: SpatialCard[];
  cards: SpatialCard[];
  onUpdateCard: (cardId: string, patch: Partial<SpatialCard>) => void;
  onAlign: (alignment: AlignmentType) => void;
  onArrangeGrid: () => void;
  /** Draws a section around the selected cards. */
  onWrapInSection: () => void;
  onClose: () => void;
  linkedPromptFor: (card: SpatialCard) => { title: string; text: string } | undefined;
}

/** Right-hand panel: the selected card's parameters, or layout tools for several cards. */
export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selected,
  cards,
  onUpdateCard,
  onAlign,
  onArrangeGrid,
  onWrapInSection,
  onClose,
  linkedPromptFor,
}) => {
  if (selected.length === 0) return null;
  const single = selected.length === 1 ? selected[0] : null;
  const meta = single ? TYPE_META[single.type] : null;
  const Icon = meta?.icon;
  const update = (patch: Partial<SpatialCard>) => single && onUpdateCard(single.id, patch);

  return (
    <aside
      style={{ width: INSPECTOR_WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`fixed right-4 top-[72px] z-30 flex flex-col max-h-[calc(100vh-88px)] bg-canvas-surface/95 backdrop-blur border border-slate-800 rounded-2xl shadow-2xl shadow-black/50 ${single ? 'bottom-4' : ''}`}
    >
      <header className="flex items-center gap-2 pl-4 pr-2 h-12 border-b border-canvas-border flex-shrink-0">
        {single && Icon ? (
          <>
            <Icon className={`w-4 h-4 ${ACCENT[ACCENT_BY_CARD_TYPE[single.type]].text}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-slate-100 truncate">{single.title}</div>
              <div className="text-[11px] text-slate-500">
                {meta!.label}
                {` · ${ROLE_LABEL[single.role]}`}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 text-xs font-semibold text-slate-100">已选中 {selected.length} 张卡片</div>
        )}
        <IconButton title="关闭（Esc）" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </IconButton>
      </header>

      <div className="flex-1 overflow-y-auto px-4">
        {single?.type === 'upload' ? (
          // Upload cards have no generation settings, only where they upload to.
          <UploadInspector card={single} update={update} />
        ) : single?.role === 'result' ? (
          // Result cards show what they were generated with; nothing to edit.
          <ResultSnapshotView card={single} sourceTitle={cards.find((c) => c.id === single.sourceId)?.title} />
        ) : (
          <>
            {single?.type === 'image' && (
              <ImageInspector card={single} cards={cards} update={update} linkedPromptText={linkedPromptFor(single)?.text} />
            )}
            {single?.type === 'video' && (
              <VideoInspector card={single} cards={cards} update={update} linkedPromptText={linkedPromptFor(single)?.text} />
            )}
            {single?.type === 'text' && <TextInspector card={single} update={update} />}
          </>
        )}

        {!single && (
          <Section title="排列">
            <div className="grid grid-cols-6 gap-1">
              {ALIGN_ACTIONS.map((a) => (
                <IconButton key={a.type} title={a.title} onClick={() => onAlign(a.type)}>
                  {a.icon}
                </IconButton>
              ))}
            </div>
            <Button block icon={<LayoutGrid className="w-3.5 h-3.5" />} onClick={onArrangeGrid}>
              按网格排列
            </Button>
            <Button block icon={<SquareDashed className="w-3.5 h-3.5" />} onClick={onWrapInSection}>
              用分区框住（Ctrl+G）
            </Button>
          </Section>
        )}
      </div>
    </aside>
  );
};
