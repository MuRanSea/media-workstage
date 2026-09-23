import type { SpatialCard } from '../types/canvas.ts';

/**
 * Unpacks transparent PNG layers produced by Seedream 5.0 Pro layer decomposition
 * into independent first-class SpatialCard nodes on the canvas.
 */
export function unpackLayerDecomposition(
  parentCard: SpatialCard,
  allCards: SpatialCard[],
  gapX = 40,
  gapY = 30,
  columns = 2
): SpatialCard[] {
  const layerAssets = (parentCard.outputAssets ?? []).filter(
    (a) => a.kind === 'image_layer'
  );

  if (layerAssets.length === 0) {
    return allCards;
  }

  const existingIds = new Set(allCards.map((c) => c.id));
  const maxTagIndex = Math.max(0, ...allCards.map((c) => c.tagIndex));

  const startX = parentCard.x + parentCard.width + gapX;
  const startY = parentCard.y;

  const newCards: SpatialCard[] = [];

  layerAssets.forEach((asset, idx) => {
    const cardId = `layer-${asset.id || idx}-${parentCard.id}`;
    if (existingIds.has(cardId)) {
      return;
    }

    const col = idx % columns;
    const row = Math.floor(idx / columns);

    const layerWidth = 330;
    const layerHeight = 360;

    const x = startX + col * (layerWidth + gapX);
    const y = startY + row * (layerHeight + gapY);

    const assetPath = asset.local_path
      ? asset.local_path.startsWith('/') || asset.local_path.startsWith('assets/')
        ? `/${asset.local_path.replace(/^\/+/, '')}`
        : `/assets/${asset.local_path}`
      : asset.remote_url;

    const newCard: SpatialCard = {
      id: cardId,
      type: 'image',
      title: `${parentCard.title} - ${asset.name || `图层 ${idx + 1}`}`,
      tagIndex: maxTagIndex + idx + 1,
      x,
      y,
      width: layerWidth,
      prompt: `${parentCard.prompt} (图层: ${asset.name || asset.description || `Layer ${asset.z_index}`})`,
      model: parentCard.model,
      status: 'succeeded',
      progress: 100,
      resultUrl: assetPath,
      imageMode: 'single',
      sizeMode: parentCard.sizeMode,
      imageTier: parentCard.imageTier,
      imageRatioPreset: parentCard.imageRatioPreset,
      imageFormat: 'png',
      background: 'transparent',
      watermark: false,
    };

    newCards.push(newCard);
  });

  return [...allCards, ...newCards];
}

/**
 * Unpacks sequential storyboard frame images produced by Seedream 5.0 Lite
 * into independent first-class SpatialCard nodes on the canvas.
 */
export function unpackSequentialStoryboards(
  parentCard: SpatialCard,
  allCards: SpatialCard[],
  gapX = 40,
  gapY = 30,
  columns = 3
): SpatialCard[] {
  const frameAssets = (parentCard.outputAssets ?? []).filter(
    (a) => a.kind === 'image_frame'
  );

  if (frameAssets.length === 0) {
    return allCards;
  }

  const existingIds = new Set(allCards.map((c) => c.id));
  const maxTagIndex = Math.max(0, ...allCards.map((c) => c.tagIndex));

  const startX = parentCard.x + parentCard.width + gapX;
  const startY = parentCard.y;

  const newCards: SpatialCard[] = [];

  frameAssets.forEach((asset, idx) => {
    const cardId = `frame-${asset.id || idx}-${parentCard.id}`;
    if (existingIds.has(cardId)) {
      return;
    }

    const col = idx % columns;
    const row = Math.floor(idx / columns);

    const frameWidth = 330;
    const frameHeight = 360;

    const x = startX + col * (frameWidth + gapX);
    const y = startY + row * (frameHeight + gapY);

    const assetPath = asset.local_path
      ? asset.local_path.startsWith('/') || asset.local_path.startsWith('assets/')
        ? `/${asset.local_path.replace(/^\/+/, '')}`
        : `/assets/${asset.local_path}`
      : asset.remote_url;

    const newCard: SpatialCard = {
      id: cardId,
      type: 'image',
      title: `${parentCard.title} - 分镜 ${idx + 1}`,
      tagIndex: maxTagIndex + idx + 1,
      x,
      y,
      width: frameWidth,
      prompt: `${parentCard.prompt} (分镜帧 ${idx + 1})`,
      model: parentCard.model,
      status: 'succeeded',
      progress: 100,
      resultUrl: assetPath,
      imageMode: 'single',
      sizeMode: parentCard.sizeMode,
      imageTier: parentCard.imageTier,
      imageRatioPreset: parentCard.imageRatioPreset,
      imageFormat: 'jpeg',
      background: 'opaque',
      watermark: parentCard.watermark,
    };

    newCards.push(newCard);
  });

  return [...allCards, ...newCards];
}
