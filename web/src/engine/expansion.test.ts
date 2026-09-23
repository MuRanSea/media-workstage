import { describe, it, expect } from 'vitest';
import {
  unpackLayerDecomposition,
  unpackSequentialStoryboards,
} from './expansion.ts';
import type { SpatialCard } from '../types/canvas.ts';

describe('Spatial Canvas Asset Expansion', () => {
  it('unpacks transparent PNG layers into independent spatial cards with @图N tags', () => {
    const parentCard: SpatialCard = {
      id: 'parent-img-1',
      type: 'image',
      title: '主角色原画',
      tagIndex: 1,
      x: 100,
      y: 100,
      width: 330,
      prompt: '赛博朋克机甲少女',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      imageMode: 'layer_decomp',
      outputAssets: [
        {
          id: 'asset-base',
          task_id: 'task-1',
          asset_index: 0,
          kind: 'image_base',
          name: 'base.png',
          local_path: 'images/task-1/base.png',
          z_index: 0,
        },
        {
          id: 'asset-layer-1',
          task_id: 'task-1',
          asset_index: 1,
          kind: 'image_layer',
          name: 'Character',
          description: '机甲少女前景图层',
          local_path: 'images/task-1/layer_00.png',
          z_index: 1,
          bounding_box_json: '{"absolute":[100,200,500,800]}',
        },
        {
          id: 'asset-layer-2',
          task_id: 'task-1',
          asset_index: 2,
          kind: 'image_layer',
          name: 'Background',
          description: '霓虹雨夜背景图层',
          local_path: 'images/task-1/layer_01.png',
          z_index: 2,
          bounding_box_json: '{"absolute":[0,0,2048,2048]}',
        },
      ],
    };

    const initialCards: SpatialCard[] = [parentCard];
    const expandedCards = unpackLayerDecomposition(parentCard, initialCards);

    // Initial 1 parent + 2 layers = 3 total cards
    expect(expandedCards.length).toBe(3);

    const layer1Card = expandedCards.find((c) => c.id.includes('asset-layer-1'))!;
    const layer2Card = expandedCards.find((c) => c.id.includes('asset-layer-2'))!;

    expect(layer1Card).toBeDefined();
    expect(layer2Card).toBeDefined();

    // Check tags: parent is @图1 -> layers receive @图2 and @图3
    expect(layer1Card.tagIndex).toBe(2);
    expect(layer2Card.tagIndex).toBe(3);

    // Check titles & paths
    expect(layer1Card.title).toContain('Character');
    expect(layer1Card.resultUrl).toBe('/assets/images/task-1/layer_00.png');
    expect(layer1Card.background).toBe('transparent');

    // Check spatial positioning (placed to the right of parent)
    expect(layer1Card.x).toBeGreaterThan(parentCard.x + parentCard.width);
  });

  it('unpacks sequential storyboard frames into horizontal grid cards', () => {
    const parentCard: SpatialCard = {
      id: 'parent-seq-1',
      type: 'image',
      title: '故事分镜脚本',
      tagIndex: 5,
      x: 200,
      y: 300,
      width: 330,
      prompt: '四格连环分镜故事',
      model: 'doubao-seedream-5-0-lite-260128',
      status: 'succeeded',
      progress: 100,
      imageMode: 'sequential',
      outputAssets: [
        {
          id: 'frame-1',
          task_id: 't-seq',
          asset_index: 0,
          kind: 'image_frame',
          name: 'storyboard_00.png',
          local_path: 'images/t-seq/storyboard_00.png',
          z_index: 0,
        },
        {
          id: 'frame-2',
          task_id: 't-seq',
          asset_index: 1,
          kind: 'image_frame',
          name: 'storyboard_01.png',
          local_path: 'images/t-seq/storyboard_01.png',
          z_index: 1,
        },
      ],
    };

    const expanded = unpackSequentialStoryboards(parentCard, [parentCard]);
    expect(expanded.length).toBe(3);

    const frame1 = expanded[1];
    const frame2 = expanded[2];

    expect(frame1.tagIndex).toBe(6);
    expect(frame2.tagIndex).toBe(7);
    expect(frame1.title).toContain('分镜 1');
    expect(frame2.title).toContain('分镜 2');
  });
});
