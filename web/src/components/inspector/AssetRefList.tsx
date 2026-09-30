import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { AssetKind, SpatialCard } from '../../types/canvas.ts';
import { ASSET_KIND_LABELS, addAssetRefPatch, assetPromptName, removeAssetRefPatch } from '../../engine/cardParams.ts';
import { Button, Segmented, inputClass } from '../ui/index.ts';

interface Props {
  card: SpatialCard;
  update: (patch: Partial<SpatialCard>) => void;
}

/** A Seedance card's references to items already in the Ark asset library, entered by asset ID. */
export const AssetRefList: React.FC<Props> = ({ card, update }) => {
  const [kind, setKind] = useState<AssetKind>('image');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const assets = card.assetRefs ?? [];

  const add = () => {
    const res = addAssetRefPatch(card, input, kind);
    if (!res.ok) return setError(res.reason);
    update(res.patch);
    setInput('');
    setError(null);
  };

  return (
    <div className="space-y-2">
      {assets.length > 0 && (
        <ul className="space-y-1">
          {assets.map((asset) => (
            <li key={asset.assetId} className="flex items-center gap-2 rounded-lg bg-canvas-bg border border-canvas-border px-2 py-1.5 text-xs">
              <span className="font-mono text-violet-300 flex-shrink-0">{assetPromptName(card, asset)}</span>
              <span className="flex-1 min-w-0 truncate font-mono text-slate-300" title={asset.assetId}>
                {asset.assetId}
              </span>
              <button
                type="button"
                title="移除"
                onClick={() => update(removeAssetRefPatch(card, asset.assetId))}
                className="p-0.5 text-slate-500 hover:text-rose-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Segmented
        value={kind}
        onChange={setKind}
        options={(Object.keys(ASSET_KIND_LABELS) as AssetKind[]).map((k) => ({ value: k, label: ASSET_KIND_LABELS[k] }))}
      />
      <div className="flex gap-1.5">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="asset-20260401123823-6d4x2"
          className={`${inputClass} flex-1 min-w-0 font-mono focus:border-indigo-500`}
        />
        <Button onClick={add} disabled={!input.trim()}>
          添加
        </Button>
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      <p className="text-[11px] leading-relaxed text-slate-500">
        填入方舟素材库或虚拟人像库里已有素材的 ID；自己的文件请用上传卡片。提示词里用左侧的名字（如「视频1」）指代，不要写 ID。
      </p>
    </div>
  );
};
