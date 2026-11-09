import { useState } from 'react';
import { FolderInput, Loader2 } from 'lucide-react';
import { DOCUMENT_FOLDER_NAMES } from '../utils/activityFileFolder';
import type { ActivityAttachment } from '../utils/attachments';

/**
 * «این فایل‌ها در پوشهٔ مدارک پروژه هم ذخیره شوند؟» — asked after a message
 * with files is sent in an activity category, since nothing files them there
 * on its own. The category's own folder is offered first and can be changed.
 */
export default function ActivityFilesFolderPrompt({
  files,
  categoryName,
  defaultFolder,
  onConfirm,
  onClose,
}: {
  files: ActivityAttachment[];
  categoryName: string;
  defaultFolder: string;
  onConfirm: (folder: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState(defaultFolder);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" dir="rtl" data-activity-files-prompt>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><FolderInput size={18} /> ذخیره در مدارک پروژه؟</h3>
        <p className="text-sm text-slate-600 leading-relaxed">
          {files.length === 1 ? 'فایل' : `${files.length} فایل`} این پیام در دسته‌بندی «{categoryName}» فقط روی خود پیام است.
          در پوشهٔ مدارک پروژه هم ذخیره شود؟
        </p>
        <ul className="text-xs text-slate-500 space-y-0.5">
          {files.map((f) => <li key={f.url} className="truncate">• {f.name}</li>)}
        </ul>
        <label className="block text-sm">
          <span className="text-slate-600">پوشه</span>
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
            data-activity-files-folder
          >
            {DOCUMENT_FOLDER_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2 text-sm rounded-lg border border-slate-200" data-activity-files-no>خیر</button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onConfirm(folder);
              setBusy(false);
              if (ok) onClose();
            }}
            className="px-4 py-2 text-sm rounded-lg bg-sky-600 text-white font-bold flex items-center gap-1.5"
            data-activity-files-yes
          >
            {busy && <Loader2 size={14} className="animate-spin" />} بله، ذخیره کن
          </button>
        </div>
      </div>
    </div>
  );
}
