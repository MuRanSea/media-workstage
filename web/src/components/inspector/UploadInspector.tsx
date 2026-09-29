import React from 'react';
import type { SpatialCard } from '../../types/canvas.ts';
import { useChannels } from '../../services/channels.ts';
import { Field, Section, inputClass } from '../ui/index.ts';

/** Where an upload card sends its file, and how video cards will reference it. */
export const UploadInspector: React.FC<{ card: SpatialCard; update: (patch: Partial<SpatialCard>) => void }> = ({ card, update }) => {
  const providers = useChannels().filter((p) => p.is_configured);
  const provider = card.uploadProvider && providers.some((p) => p.id === card.uploadProvider) ? card.uploadProvider : providers[0]?.id ?? '';

  return (
    <>
      <Section title="上传到">
        <Field
          label="服务商"
          hint="使用该服务商 Base URL 所在站点的素材库（/api/volcengine/assets）和文件存储（/api/files/upload）接口，密钥同服务商设置。"
        >
          <select value={provider} onChange={(e) => update({ uploadProvider: e.target.value })} className={inputClass}>
            {providers.length === 0 && <option value="">还没有配置好的服务商</option>}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
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
