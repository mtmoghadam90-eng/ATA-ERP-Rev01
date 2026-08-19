import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Upload, Loader2, AlertCircle, CheckCircle2, Award, Search,
  Eye, Download, Trash2, FileArchive, Filter, RotateCcw,
} from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';
import { ERPSettings } from '../types';
import { uploadFile, downloadFileFromServer } from '../imageUtils';
import { getTodayShamsi } from '../dateUtils';
import { formatMoney } from '../numUtils';
import { projectsApi } from '../api/projects';
import { useEntitySearch } from '../api/useEntitySearch';
import type { ProjectRow } from '../api/projects';
import {
  satisfactionLettersApi, SatisfactionLetterQuery, SatisfactionLetterRow,
} from '../api/satisfactionLetters';

/**
 * Customer satisfaction letters, for every project at once.
 *
 * A letter is stored as an ordinary project document tagged
 * `kind: 'satisfactionLetter'`, so it also appears in that project's documents
 * tab under «رضایت‌نامه‌ها» — this screen is a view across them, not a second
 * store. Writing therefore goes through the project endpoint, exactly as the
 * documents tab does; only reading and zipping have endpoints of their own.
 */

const LETTER_FOLDER = 'رضایت‌نامه‌ها';
const LETTER_KIND = 'satisfactionLetter';
/** Matches the server's sanitizer: a Persian folder name would be stripped. */
const LETTER_UPLOAD_FOLDER = 'satisfaction-letters';

interface SatisfactionLettersModalProps {
  isOpen: boolean;
  settings: ERPSettings;
  onClose: () => void;
}

/** The filters as the form holds them, before they become a query. */
interface FilterState {
  search: string;
  equipmentType: string;
  minAmount: string;
  maxAmount: string;
  minItems: string;
  maxItems: string;
}

const EMPTY_FILTERS: FilterState = {
  search: '', equipmentType: '', minAmount: '', maxAmount: '', minItems: '', maxItems: '',
};

export default function SatisfactionLettersModal({
  isOpen,
  settings,
  onClose,
}: SatisfactionLettersModalProps) {
  const [rows, setRows] = useState<SatisfactionLetterRow[]>([]);
  // A count of projects, not a money total — so it is written in Persian
  // digits, unlike every amount on this screen.
  const [projectCount, setProjectCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* What the user is typing, and what has actually been asked for. Separate so
     a half-typed amount does not fire a request on every keystroke. */
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customFileName, setCustomFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyLetterId, setBusyLetterId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* `selectedId` keeps the chosen project among the options once the user types
     a new search — without it the field falls back to its placeholder and reads
     as though the selection had been cleared. */
  const projectPicker = useEntitySearch<ProjectRow>({
    path: '/api/projects', limit: 25, enabled: isOpen,
    params: { withSummary: 'false' },
    selectedId: selectedProjectId || null,
    getLabel: (row) => `${row.name} (${row.code})`,
  });

  const toQuery = (filters: FilterState): SatisfactionLetterQuery => ({
    search: filters.search || undefined,
    equipmentType: filters.equipmentType || undefined,
    minAmount: filters.minAmount || undefined,
    maxAmount: filters.maxAmount || undefined,
    minItems: filters.minItems || undefined,
    maxItems: filters.maxItems || undefined,
  });

  const load = useCallback(async (filters: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const result = await satisfactionLettersApi.list(toQuery(filters));
      setRows(result.rows);
      setProjectCount(result.total);
      setTruncated(result.truncated);
    } catch (err: any) {
      setError(err?.message || 'خواندن فهرست رضایت‌نامه‌ها با خطا مواجه شد.');
      setRows([]);
      setProjectCount(0);
      setTruncated(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Opening the window reads the list; closing it forgets everything typed, so
  // the next open is not filtered by something set days ago.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setSelectedProjectId('');
    setSelectedFile(null);
    setCustomFileName('');
    setUploadError(null);
    setNotice(null);
    void load(EMPTY_FILTERS);
  }, [isOpen, load]);

  if (!isOpen) return null;

  const equipmentTypes: string[] = settings?.dropdownItems?.equipmentTypes ?? [];
  const projects = projectPicker.matches;
  const hasAnyFile = rows.some((row) => row.letters.length > 0);

  const handleApplyFilters = () => {
    setApplied(draft);
    void load(draft);
  };

  const handleResetFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    void load(EMPTY_FILTERS);
  };

  const handleFilePicked = (file: File) => {
    setSelectedFile(file);
    const withoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    const project = projects.find((p) => p.id === selectedProjectId);
    setCustomFileName(project ? `رضایت‌نامه_${project.code}_${withoutExt}` : `رضایت‌نامه_${withoutExt}`);
    setUploadError(null);
  };

  /**
   * Files the letter onto the project.
   *
   * The project is re-read immediately before the write rather than trusting
   * anything this screen is holding: `manualDocuments` is one JSON column, so
   * appending to a stale copy would drop every document added since — including
   * letters filed from this same window a moment ago.
   */
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      setUploadError('لطفاً ابتدا پروژه را انتخاب کنید.');
      return;
    }
    if (!selectedFile) {
      setUploadError('لطفاً فایل رضایت‌نامه را انتخاب کنید.');
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setNotice(null);
    try {
      const url = await uploadFile(selectedFile, LETTER_UPLOAD_FOLDER);

      const originalName = selectedFile.name;
      const ext = originalName.substring(originalName.lastIndexOf('.')) || '';
      const finalName = customFileName ? `${customFileName}${ext}` : originalName;

      const fresh = await projectsApi.get(selectedProjectId);
      const existing = parseDocuments(fresh.manualDocuments);

      await projectsApi.update(selectedProjectId, {
        manualDocuments: [
          ...existing,
          {
            id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            folderName: LETTER_FOLDER,
            name: finalName,
            url,
            createdAt: getTodayShamsi(),
            size: `${(selectedFile.size / 1024).toFixed(1)} KB`,
            kind: LETTER_KIND,
          },
        ],
      });

      setSelectedFile(null);
      setCustomFileName('');
      setNotice(`رضایت‌نامه «${finalName}» ثبت شد.`);
      await load(applied);
    } catch (err: any) {
      setUploadError(err?.message || 'ثبت رضایت‌نامه با خطا مواجه شد.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (row: SatisfactionLetterRow, letterId: string, letterName: string) => {
    if (!confirm(`آیا از حذف رضایت‌نامه «${letterName}» از پروژه «${row.name}» اطمینان دارید؟`)) return;

    setBusyLetterId(letterId);
    setError(null);
    try {
      // Same reason as the upload: re-read, then remove by id.
      const fresh = await projectsApi.get(row.id);
      const remaining = parseDocuments(fresh.manualDocuments).filter((doc) => doc.id !== letterId);
      await projectsApi.update(row.id, { manualDocuments: remaining });
      setNotice(`رضایت‌نامه «${letterName}» حذف شد.`);
      await load(applied);
    } catch (err: any) {
      setError(err?.message || 'حذف رضایت‌نامه با خطا مواجه شد.');
    } finally {
      setBusyLetterId(null);
    }
  };

  const handleDownloadZip = () => {
    // A plain navigation, so the browser streams the archive to disk itself.
    window.location.href = satisfactionLettersApi.zipUrl(toQuery(applied));
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto" dir="rtl">
      <div
        className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={() => !isUploading && onClose()}
      />

      <div className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl border border-slate-100 text-right z-10 flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-xl border border-amber-100">
              <Award size={20} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">ثبت رضایت‌نامه‌های مشتریان</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                بارگذاری رضایت‌نامه هر پروژه در پوشه «{LETTER_FOLDER}» پرونده همان پروژه
              </p>
            </div>
          </div>
          {!isUploading && (
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-lg transition"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">

          {/* ---------- Upload form ---------- */}
          <form onSubmit={handleUpload} className="bg-slate-50/70 border border-slate-150 rounded-2xl p-4 space-y-3.5">
            <h4 className="font-bold text-slate-700 flex items-center gap-1.5">
              <Upload size={14} className="text-sky-600" />
              ثبت رضایت‌نامه جدید
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-slate-600 font-bold">پروژه:</label>
                <SearchableSelect
                  value={selectedProjectId}
                  onChange={(val) => {
                    setSelectedProjectId(val);
                    setUploadError(null);
                  }}
                  onSearchChange={projectPicker.setTerm}
                  loading={projectPicker.loading}
                  placeholder="-- انتخاب پروژه --"
                  className="text-xs"
                  options={projects.map((p) => ({
                    value: p.id,
                    label: `${p.name} (${p.code})`,
                  }))}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-600 font-bold">نام سند در سیستم:</label>
                <input
                  type="text"
                  value={customFileName}
                  onChange={(e) => setCustomFileName(e.target.value)}
                  placeholder="مثلاً: رضایت‌نامه_کارفرما"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-semibold focus:outline-none focus:border-sky-500 text-slate-700"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-slate-600 font-bold">فایل رضایت‌نامه:</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 hover:border-sky-500 hover:bg-white rounded-xl p-4 text-center cursor-pointer transition flex items-center justify-center gap-2.5 min-h-[64px]"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) handleFilePicked(e.dataTransfer.files[0]);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFilePicked(e.target.files[0]);
                    if (e.target) e.target.value = '';
                  }}
                />
                {selectedFile ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                    <span className="font-bold font-mono text-[11px] truncate max-w-[320px]" dir="ltr">
                      {selectedFile.name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Upload size={18} className="shrink-0" />
                    <span className="font-medium">فایل را بکشید یا کلیک کنید (PDF یا تصویر)</span>
                  </div>
                )}
              </div>
            </div>

            {uploadError && (
              <div className="p-2.5 bg-rose-50 text-rose-800 border border-rose-100 rounded-xl text-[11px] flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}
            {notice && (
              <div className="p-2.5 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-xl text-[11px] flex items-start gap-2">
                <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                <span>{notice}</span>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isUploading || !selectedFile || !selectedProjectId}
                className="px-5 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 min-w-[130px] justify-center"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>در حال ثبت...</span>
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    <span>ثبت رضایت‌نامه</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* ---------- Filters ---------- */}
          <div className="bg-white border border-slate-150 rounded-2xl p-4 space-y-3">
            <h4 className="font-bold text-slate-700 flex items-center gap-1.5">
              <Filter size={14} className="text-slate-500" />
              فیلتر فهرست
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="block text-slate-600 font-bold">جستجو (نام/کد پروژه، کارفرما):</label>
                <div className="relative">
                  <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    value={draft.search}
                    onChange={(e) => setDraft({ ...draft, search: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleApplyFilters(); }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-8 pl-3 py-2 text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-600 font-bold">نوع محصول (تجهیز):</label>
                <select
                  value={draft.equipmentType}
                  onChange={(e) => setDraft({ ...draft, equipmentType: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-sky-500"
                >
                  <option value="">همه‌ی انواع</option>
                  {equipmentTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-600 font-bold">تعداد کالای پروژه (از / تا):</label>
                <div className="flex gap-2">
                  <input
                    type="number" min={0} placeholder="از"
                    value={draft.minItems}
                    onChange={(e) => setDraft({ ...draft, minItems: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-left focus:outline-none focus:border-sky-500"
                    dir="ltr"
                  />
                  <input
                    type="number" min={0} placeholder="تا"
                    value={draft.maxItems}
                    onChange={(e) => setDraft({ ...draft, maxItems: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-left focus:outline-none focus:border-sky-500"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="block text-slate-600 font-bold">
                  مبلغ فروش پروژه — ریال (از / تا):
                  <span className="text-[10px] text-slate-400 font-medium mr-1">
                    بر اساس اقلام برنده‌ی پیش‌فاکتورها
                  </span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number" min={0} placeholder="از"
                    value={draft.minAmount}
                    onChange={(e) => setDraft({ ...draft, minAmount: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-left focus:outline-none focus:border-sky-500"
                    dir="ltr"
                  />
                  <input
                    type="number" min={0} placeholder="تا"
                    value={draft.maxAmount}
                    onChange={(e) => setDraft({ ...draft, maxAmount: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-left focus:outline-none focus:border-sky-500"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
                >
                  <Filter size={13} />
                  اعمال فیلتر
                </button>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                  title="حذف فیلترها"
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* ---------- Results ---------- */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <span className="font-bold text-slate-700">
                فهرست رضایت‌نامه‌ها
                <span className="text-slate-400 font-medium mr-1.5">
                  ({projectCount.toLocaleString('fa-IR')} پروژه)
                </span>
              </span>
              <button
                type="button"
                onClick={handleDownloadZip}
                disabled={loading || !hasAnyFile}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                title="دانلود همه‌ی فایل‌های فهرست فیلترشده در یک فایل زیپ"
              >
                <FileArchive size={14} />
                دانلود زیپ فهرست فیلترشده
              </button>
            </div>

            {truncated && (
              <div className="p-2.5 bg-amber-50 text-amber-800 border border-amber-100 rounded-xl text-[11px] flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>تعداد نتایج از حد نمایش بیشتر است و فهرست کوتاه شده. لطفاً فیلترها را محدودتر کنید.</span>
              </div>
            )}

            {error && (
              <div className="p-2.5 bg-rose-50 text-rose-800 border border-rose-100 rounded-xl text-[11px] flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="border border-slate-150 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 text-right font-bold">نام پروژه</th>
                      <th className="px-3 py-2.5 text-right font-bold whitespace-nowrap">تعداد کالا</th>
                      <th className="px-3 py-2.5 text-right font-bold whitespace-nowrap">مبلغ فروش (ریال)</th>
                      <th className="px-3 py-2.5 text-right font-bold">فایل رضایت‌نامه</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                          <Loader2 size={18} className="animate-spin inline-block" />
                        </td>
                      </tr>
                    )}

                    {!loading && rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-slate-400 font-medium">
                          هنوز رضایت‌نامه‌ای ثبت نشده است، یا هیچ موردی با این فیلترها مطابقت ندارد.
                        </td>
                      </tr>
                    )}

                    {!loading && rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/60 align-top">
                        <td className="px-3 py-3">
                          <div className="font-bold text-slate-800">{row.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{row.code}</div>
                          {row.customerName && (
                            <div className="text-[10px] text-slate-500 mt-0.5">کارفرما: {row.customerName}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono text-slate-600" dir="ltr">
                          {row.itemCount}
                        </td>
                        <td className="px-3 py-3 font-mono text-slate-700 whitespace-nowrap" dir="ltr">
                          {row.salesAmount === null ? (
                            <span className="text-slate-400 font-sans" dir="rtl">نرخ ارز ثبت نشده</span>
                          ) : formatMoney(row.salesAmount)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="space-y-1.5">
                            {row.letters.map((letter) => (
                              <div
                                key={letter.id}
                                className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-150 rounded-lg px-2.5 py-1.5"
                              >
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-700 truncate max-w-[260px]">
                                    {letter.name}
                                  </div>
                                  <div className="text-[9px] text-slate-400 font-mono">
                                    {[letter.createdAt, letter.size].filter(Boolean).join(' · ')}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <a
                                    href={letter.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1.5 text-sky-600 hover:bg-sky-50 rounded-lg transition"
                                    title="مشاهده"
                                  >
                                    <Eye size={14} />
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => void downloadFileFromServer(letter.url, letter.name)}
                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
                                    title="دانلود"
                                  >
                                    <Download size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyLetterId === letter.id}
                                    onClick={() => void handleDelete(row, letter.id, letter.name)}
                                    className="p-1.5 text-rose-600 hover:bg-rose-50 disabled:text-slate-300 rounded-lg transition"
                                    title="حذف"
                                  >
                                    {busyLetterId === letter.id
                                      ? <Loader2 size={14} className="animate-spin" />
                                      : <Trash2 size={14} />}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end p-4 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

/** A project's `manualDocuments` column, whether it arrives as JSON or parsed. */
function parseDocuments(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
