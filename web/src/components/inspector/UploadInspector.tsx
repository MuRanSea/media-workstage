import React from 'react';
import type { SpatialCard } from '../../types/canvas.ts';
import { useUploadPlatform } from '../../services/uploadPlatform.ts';
import { Section } from '../ui/index.ts';

/** Where an upload card sends its file, and how video cards will reference it. */
export const UploadInspector: React.FC<{ card: SpatialCard; update: (patch: Partial<SpatialCard>) => void }> = ({ card }) => {
  const platform = useUploadPlatform();

  return (
    <>
      <Section title="上传平台">
        <p className="text-[11px] leading-relaxed text-slate-400">
          「上传素材库」和「获取链接」都发到上传平台
          {platform && <span className="font-mono text-slate-300"> {platform.base_url}</span>}
          {platform && !platform.is_configured && <span className="text-amber-300">（还没有填 API Key）</span>}
          ，在「设置 → 上传平台」里配置，与服务商无关。
          {platform && (
            <>
              {' '}
              接口说明见{' '}
              <a href={platform.docs_url} target="_blank" rel="noreferrer" className="underline hover:text-slate-200">
                平台文档
              </a>
              。
            </>
          )}
        </p>
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
