import { useRef, useState } from 'react';
import {
  apiBatchMediaTasks, apiDeleteMediaFile, apiGetMediaFile, apiListMediaFiles, apiQueryMediaTasks, apiUploadMediaFile,
  type ManagedMediaFile, type MediaFilePurpose, type RemoteMediaTask,
} from '../services/media.ts';
import { billingLabel } from '../engine/mediaBilling.ts';
import { useDialogs } from './ui/index.ts';

const input = 'w-full min-w-0 rounded border border-canvas-border bg-canvas-bg px-2 py-1';
const button = 'rounded border border-canvas-border px-2 py-1 text-slate-200 hover:border-cyan-400 disabled:opacity-40';
const fileStatus: Record<string, string> = { ready: '可引用', processing: '处理中', rejected: '已拒绝', expired: '已过期', deleting: '删除中' };

export function HeighlinerMediaPane({ provider }: { provider: string }) {
  const [purpose, setPurpose] = useState<MediaFilePurpose>('reference');
  const [group, setGroup] = useState('');
  const [files, setFiles] = useState<ManagedMediaFile[]>([]);
  const [details, setDetails] = useState<ManagedMediaFile>();
  const [next, setNext] = useState<number | null>();
  const [queryType, setQueryType] = useState<'cursor' | 'ids' | 'external'>('cursor');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [tasks, setTasks] = useState<RemoteMediaTask[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const { confirm } = useDialogs();
  const perform = async (run: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await run(); }
    catch (err) { setError((err as Error).message); }
    finally { pending.current = false; setBusy(false); }
  };
  const list = async (page: number) => {
    const result = await apiListMediaFiles(provider, purpose, group.trim(), page);
    setFiles((prev) => [...new Map((page === 1 ? result.items : [...prev, ...result.items]).map((file) => [file.id, file])).values()]);
    setNext(result.next_page);
  };
  const search = async (after?: string) => {
    const result = queryType === 'cursor'
      ? await apiQueryMediaTasks(provider, { limit: 20, ...(after ? { cursor: after } : { models: query.trim() ? [query.trim()] : undefined, statuses: status ? [status] : undefined }) })
      : await apiBatchMediaTasks(provider, query.trim(), queryType === 'external');
    setTasks(result.items ?? []);
    setCursor(result.next_cursor);
  };
  return (
    <details className="space-y-3 rounded-lg border border-canvas-border p-3">
      <summary className="cursor-pointer font-semibold text-cyan-300">Media API：平台文件与任务</summary>
      <p className="text-slate-400">以下操作只访问此服务商；查询不创建生成。平台文件 ID 和素材 ID 不可互换。</p>
      <fieldset disabled={busy} className="space-y-2">
        <div className="flex gap-2">
          <select aria-label="文件用途" value={purpose} className={input} onChange={(e) => { setPurpose(e.target.value as MediaFilePurpose); setFiles([]); setDetails(undefined); setNext(null); }}>
            <option value="reference">临时参考文件</option><option value="provider_asset">厂商素材（需审核）</option>
          </select>
          {purpose === 'provider_asset' && <input aria-label="素材组" className={input} value={group} onChange={(e) => { setGroup(e.target.value); setNext(null); }} placeholder="素材组（可选）" />}
          <button type="button" className={`${button} shrink-0`} onClick={() => void perform(() => list(1))}>查询文件</button>
        </div>
        <form className="space-y-2" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = new FormData(form);
          data.set('purpose', purpose);
          if (purpose === 'provider_asset') { if (!String(data.get('name') ?? '').trim()) data.delete('name'); if (group.trim()) data.set('group_id', group.trim()); data.set('wait_seconds', '0'); }
          void perform(async () => { const file = await apiUploadMediaFile(provider, data); setDetails(file); setNotice('已上传，请查看文件状态'); form.reset(); });
        }}>
          <input name="file" aria-label="上传文件" type="file" required accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.wav,.mp3" />
          {purpose === 'provider_asset' && <input name="name" aria-label="素材名" maxLength={64} placeholder="素材名（可选）" className={input} />}
          <button type="submit" className={button}>上传到网关</button>
        </form>
        {files.map((file) => <div key={file.id} className="flex gap-2 items-center">
          <span className="truncate flex-1" title={file.id}>{file.name || file.id} · {fileStatus[file.status] || file.status}</span>
          <button type="button" className={button} onClick={() => void perform(async () => setDetails(await apiGetMediaFile(provider, file.id)))}>详情</button>
        </div>)}
        {next != null && <button type="button" className={button} onClick={() => void perform(() => list(next))}>更多文件</button>}
        {details && <div className="space-y-1 break-all rounded border border-canvas-border p-2">
          <div>{details.name || '平台文件'} · {fileStatus[details.status] || details.status}</div>
          <div className="select-text font-mono">file_id: {details.id}</div>
          {details.asset_id && <div className="select-text font-mono">asset_id: {details.asset_id}</div>}
          {details.expires_at && <div>到期：{new Date(typeof details.expires_at === 'number' ? details.expires_at * 1000 : details.expires_at).toLocaleString()}</div>}
          <p className="text-slate-400">可在对应类型的上传卡选择此服务商并导入 file_id。素材审核通过后，生成使用 asset_id。</p>
          <div className="flex gap-2">
            <button className={button} type="button" onClick={() => void perform(async () => setDetails(await apiGetMediaFile(provider, details.id)))}>刷新状态</button>
            <button className={`${button} text-rose-300`} type="button" onClick={async () => {
              if (!await confirm({ title: '删除平台文件', message: '已引用此 ID 的卡片可能无法再次提交。本地文件不受影响。', confirmText: '删除', danger: true })) return;
              await perform(async () => { await apiDeleteMediaFile(provider, details.id); setDetails(undefined); setFiles((prev) => prev.filter((file) => file.id !== details.id)); setNotice('已收到网关的删除响应'); });
            }}>删除</button>
          </div>
        </div>}
      </fieldset>
      <fieldset disabled={busy} className="space-y-2 border-t border-canvas-border pt-3">
        <h3 className="font-medium">可灵任务查询</h3>
        <select className={input} aria-label="任务查询方式" value={queryType} onChange={(e) => { setQueryType(e.target.value as typeof queryType); setQuery(''); setTasks([]); setCursor(null); }}>
          <option value="cursor">游标查询</option><option value="ids">批量：平台任务 ID</option><option value="external">批量：业务任务 ID</option>
        </select>
        <input className={input} aria-label="查询项" value={query} onChange={(e) => { setQuery(e.target.value); setCursor(null); }} placeholder={queryType === 'cursor' ? '模型 ID（可选）' : '多个 ID 用英文逗号分隔'} />
        {queryType === 'cursor' && <select className={input} aria-label="状态" value={status} onChange={(e) => { setStatus(e.target.value); setCursor(null); }}>
          <option value="">全部状态</option>{['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired', 'reconciling'].map((s) => <option key={s}>{s}</option>)}
        </select>}
        <button className={button} type="button" disabled={queryType !== 'cursor' && !query.trim()} onClick={() => void perform(() => search())}>查询任务</button>
        {tasks.map((task) => <div className="break-all" key={task.id}>{task.id} · {task.model} · {task.status} {task.billing && `· ${billingLabel(task.billing)}`}</div>)}
        {queryType === 'cursor' && cursor && <button className={button} type="button" onClick={() => void perform(() => search(cursor))}>下一页任务</button>}
      </fieldset>
      {busy && <p role="status">正在请求网关…</p>}
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      {notice && <p role="status" className="text-cyan-300">{notice}</p>}
    </details>
  );
}
