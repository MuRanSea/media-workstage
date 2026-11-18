import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { setActiveProjectId } from '../../engine/assetPaths.ts';
import type { SpatialCard, TaskAssetDto } from '../../types/canvas.ts';
import { ImageCardView } from './ImageCardView.tsx';
import { VideoCardView } from './VideoCardView.tsx';

vi.mock('../../services/channels.ts', () => ({ useChannels: () => [] }));
vi.mock('./UploadPanel.tsx', () => ({ UploadPanel: () => null }));
const noop = () => {};
const props = { isSelected: false, onSelect: noop, onStartDrag: noop, onUpdateCard: noop, onTriggerGenerate: noop, menuItems: [], onOpenViewer: noop };
const result: SpatialCard = { id: 'card', role: 'result', type: 'video', title: 'Result', x: 0, y: 0, width: 300, prompt: '', model: 'test', status: 'succeeded', progress: 100 };
const asset = (kind: TaskAssetDto['kind'], file: string, i: number): TaskAssetDto => ({ id: file, task_id: 'task', asset_index: i, kind, local_path: 'result/' + file, z_index: 0 });
afterEach(() => setActiveProjectId(null));

it('renders project-scoped URLs for the player, poster and every downloadable attachment', () => {
  setActiveProjectId('p 1');
  const files = [asset('video', 'clip.mp4', 0), asset('cover', 'cover.jpg', 1), asset('image_frame', 'frame.png', 2)];
  const html = renderToStaticMarkup(<VideoCardView {...props} card={{ ...result, resultUrl: '/assets/result/clip.mp4', outputAssets: files }} availableImageCards={[]} onNotice={noop} />);
  const base = '/api/projects/p%201/assets/result/';
  expect(html).toContain(`src="${base}clip.mp4"`);
  expect(html).toContain(`poster="${base}cover.jpg"`);
  for (const file of files) expect(html).toContain(`href="${base}${file.id}"`);
});

it('renders late-arriving OCR and layer metadata on the result itself', () => {
  const layer = { ...asset('image_layer', 'title.png', 0), name: '标题', description: '字幕层', bounding_box_json: '[1,2,3,4]', provider_metadata_json: JSON.stringify({ volcengine: { z_index: 1, text_recognition: ['字幕文本'] } }) };
  const html = renderToStaticMarkup(<ImageCardView {...props} card={{ ...result, type: 'image', outputAssets: [layer] }} />);
  for (const text of ['图层 1', '标题', '字幕层', '[1,2,3,4]', 'OCR', '字幕文本']) expect(html).toContain(text);
});
