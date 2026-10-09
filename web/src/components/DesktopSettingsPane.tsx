import React, { useState } from 'react';
import { AlertCircle, FolderOpen, HardDrive, Info, Loader2, ScrollText } from 'lucide-react';
import {
  apiOpenLogs,
  apiRestartDesktop,
  apiSaveDesktopSettings,
  type DesktopDirSettings,
  type DesktopInfo,
} from '../services/desktop.ts';
import { Button, inputClass } from './ui/index.ts';

interface DesktopSettingsPaneProps {
  info: Extract<DesktopInfo, { enabled: true }>;
}

/** Right-hand pane of the settings modal for the desktop app's Data Directory and Projects Root. */
export const DesktopSettingsPane: React.FC<DesktopSettingsPaneProps> = ({ info }) => {
  const [form, setForm] = useState<DesktopDirSettings>(info.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = { data_dir: form.data_dir.trim(), projects_dir: form.projects_dir.trim() };
  const changed =
    trimmed.data_dir !== info.settings.data_dir.trim() || trimmed.projects_dir !== info.settings.projects_dir.trim();

  const saveAndRestart = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiSaveDesktopSettings(trimmed);
      await apiRestartDesktop();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const openLogs = () => {
    apiOpenLogs().catch((e) => setError((e as Error).message));
  };

  const field = (key: keyof DesktopDirSettings, label: string, hint: string, current: string) => (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <FolderOpen className="w-3.5 h-3.5" /> {label}
      </span>
      <input
        type="text"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className={`${inputClass} font-mono py-2`}
        placeholder="留空使用默认位置"
        spellCheck={false}
      />
      <span className="block text-[11px] text-slate-500">{hint}</span>
      <span className="block text-[11px] text-slate-500 break-all">
        当前使用：<span className="font-mono text-slate-400">{current}</span>
      </span>
    </label>
  );

  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 space-y-5 text-xs text-slate-200">
      <div className="flex items-start gap-3">
        <HardDrive className="w-5 h-5 mt-0.5 flex-shrink-0 text-slate-300" />
        <div>
          <div className="text-sm font-semibold text-slate-100">存储与日志</div>
          <p className="mt-0.5 text-[11px] text-slate-500">选择数据和工程放在哪里。修改后应用会重启。</p>
        </div>
      </div>

      <section className="space-y-4">
        {field('data_dir', '数据目录', '服务商配置、任务记录和不属于任何工程的产出。', info.data_dir)}
        {field('projects_dir', '工程目录', '每个工程一个子文件夹。', info.projects_dir)}
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-canvas-border text-[11px] leading-relaxed text-slate-400">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div>
            只切换位置，旧目录里的内容不会被移动。新目录里已有数据就直接使用，例如指向以前的数据目录或其他电脑拷来的工程。
          </div>
        </div>
      </section>

      {error && (
        <p className="flex items-start gap-1 text-[11px] text-rose-300">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void saveAndRestart()}
          disabled={!changed || busy}
          icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
        >
          {busy ? '正在重启…' : '保存并重启'}
        </Button>
      </div>

      <section className="space-y-2 pt-2 border-t border-canvas-border">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-3">日志</h3>
        <div className="flex items-center gap-3">
          <Button onClick={openLogs} icon={<ScrollText className="w-3.5 h-3.5" />}>
            打开日志目录
          </Button>
          <span className="font-mono text-[11px] text-slate-500 break-all">{info.logs_dir}</span>
        </div>
      </section>
    </div>
  );
};
