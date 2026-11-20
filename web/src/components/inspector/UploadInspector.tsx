import React from 'react';
import type { SpatialCard } from '../../types/canvas.ts';
import { useUploadPlatform } from '../../services/uploadPlatform.ts';
import { Section } from '../ui/index.ts';

/** Where an upload card sends its file, and how video cards will reference it. */
export const UploadInspector: React.FC<{ card: SpatialCard; update: (patch: Partial<SpatialCard>) => void }> = ({ card }) => {
  const assetPlatform = useUploadPlatform('asset');
  const filePlatform = useUploadPlatform('file');

  return (
    <>
      <Section title="上传平台">
        <div className="space-y-1 text-[11px] leading-relaxed text-slate-400">
          {([['上传素材库', assetPlatform], ['获取链接', filePlatform]] as const).map(([label, platform]) => (
            <p key={label}>
              {label}：{platform ? <span className="break-all font-mono text-slate-300">{platform.base_url}</span> : '读取配置中'}
              {platform && !platform.is_configured && <span className="text-amber-300">（未填写 API Key）</span>}
            </p>
          ))}
          <p>两项均在「设置 → 上传平台」里独立配置，与模型服务商无关。</p>
        </div>
      </Section>
      <Section title="引用方式">
        <p className="text-[11px] leading-relaxed text-slate-400">
          从卡片右侧圆点拖线到视频卡片，即作为{card.mediaKind === 'video' ? '参考视频' : '参考图'}。 发送给 Ark 时优先使用素材 ID（asset://…），其余情况用文件链接
          {card.mediaKind === 'video' ? '；视频必须先上传才能引用。' : '；没有上传时图片会直接内联发送。'}
        </p>
      </Section>
    </>
  );
};
