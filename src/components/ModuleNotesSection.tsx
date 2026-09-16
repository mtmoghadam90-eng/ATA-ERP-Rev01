import { useRef, useState } from "react";
import { Calendar, Loader2, MessageSquare, Paperclip, Plus, Trash2, X } from "lucide-react";
import Avatar from "./Avatar";
import { formatDateTimeToShamsi } from "../dateUtils";
import {
  ActivityAttachment, MAX_ACTIVITY_ATTACHMENTS, formatFileSize,
} from "../utils/attachments";
import { noteHasContent } from "../utils/moduleNotes";

/**
 * The notes and agreements recorded against one document.
 *
 * One component, four screens — the proforma's «توافقات خاص و کامنت‌های این
 * پیش‌فاکتور», the purchase order's, the packing list's and the after-sales
 * job's — so every rule about what a note looks like is decided once here.
 */

interface NoteItem {
  id: string;
  text: string;
  /** The stored instant as it came off the wire; folded to Shamsi below. */
  createdAt: string;
  author: string;
  attachments?: ActivityAttachment[];
  /** The server's answer, not a guess. Absent reads as allowed. */
  canDelete?: boolean;
}

interface ModuleNotesSectionProps {
  notes?: NoteItem[];
  onAddNote: (text: string, attachments?: ActivityAttachment[]) => void;
  onDeleteNote: (id: string) => void;
  title?: string;
  placeholder?: string;
}

/** The folder under `/uploads`, in Latin — see the rule in `/api/upload`. */
const NOTE_UPLOAD_FOLDER = "note-files";

export default function ModuleNotesSection({
  notes = [],
  onAddNote,
  onDeleteNote,
  title = "توافقات و یادداشت‌های خاص",
  placeholder = "توافق خاص، کامنت یا یادداشت جدید را اینجا بنویسید...",
}: ModuleNotesSectionProps) {
  const [newNoteText, setNewNoteText] = useState("");
  const [files, setFiles] = useState<ActivityAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  /*
   * **A file on its own is a note**, and this asks the *same function* the
   * server asks rather than a second reading of it. What is recorded here is
   * usually an agreement and the evidence of one is the customer's confirming
   * email or a signed page, so refusing that because no sentence was typed
   * beside it is a refusal about the wrong thing. Written twice, the two halves
   * drift the moment either is corrected — and the shape that drift takes is
   * the worst one available: a button that stays dead while the endpoint behind
   * it would have accepted the note perfectly well, with nothing on the screen
   * saying why.
   */
  const hasContent = noteHasContent(newNoteText, files);

  const handleSubmit = () => {
    if (!hasContent || uploading) return;
    onAddNote(newNoteText.trim(), files);
    setNewNoteText("");
    setFiles([]);
    setUploadError(null);
  };

  const handlePick = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const added: ActivityAttachment[] = [];
    try {
      /*
       * Required at call time rather than imported at the top, the shape
       * `CustomFieldsForm` already uses for this module: `imageUtils` pulls in
       * `file-saver` for a download helper nothing here wants, which is a CJS
       * package that does not interop under the ESM loader — so a top-level
       * import makes this component unmountable outside a bundler, and a card
       * that cannot be rendered in a test is a card whose wiring nothing checks.
       */
      const { uploadFile } = await import("../imageUtils");
      for (const file of Array.from(picked)) {
        // The size rule is `uploadFile`'s and the server's; this only reports
        // what it said, naming the file the browser refused.
        const url = await uploadFile(file, NOTE_UPLOAD_FOLDER);
        added.push({ name: file.name, size: formatFileSize(file.size), url });
      }
      setFiles((prev) => [...prev, ...added].slice(0, MAX_ACTIVITY_ATTACHMENTS));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "بارگذاری فایل ممکن نشد.");
      // Whatever did upload is kept: re-picking the ones that worked is a cost
      // paid for somebody else's failure.
      if (added.length > 0) {
        setFiles((prev) => [...prev, ...added].slice(0, MAX_ACTIVITY_ATTACHMENTS));
      }
    } finally {
      setUploading(false);
      // Or picking the same file twice in a row is silently ignored by the
      // browser, which reads as the button having stopped working.
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const atLimit = files.length >= MAX_ACTIVITY_ATTACHMENTS;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <h4 className="font-bold text-xs md:text-sm text-slate-800 flex items-center gap-2">
          <MessageSquare size={16} className="text-indigo-500" />
          {title} ({notes.length.toLocaleString("fa-IR")})
        </h4>
      </div>

      {/*
        Deliberately not a <form>. This section is dropped inside the document's
        own edit form on several screens, and a nested form is invalid HTML: the
        browser closes the outer one early, so the note's submit button was
        submitting — and saving — the whole record instead.
      */}
      <div className="space-y-2">
        <div className="relative">
          <textarea
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="w-full text-xs border border-slate-200 rounded-xl p-3 bg-slate-50/30 hover:bg-white focus:bg-white focus:border-indigo-500 transition-all resize-none outline-none leading-relaxed font-sans"
          />
        </div>

        {/* What is attached to the note being written, before it is sent. */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-note-draft-files>
            {files.map((f) => (
              <span
                key={f.url}
                className="inline-flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-lg px-2 py-1 text-[10px] max-w-full"
              >
                <Paperclip size={10} className="shrink-0" />
                <span className="truncate max-w-[160px]" title={f.name}>{f.name}</span>
                {f.size && <span className="text-indigo-400 shrink-0">{f.size}</span>}
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((x) => x.url !== f.url))}
                  className="text-indigo-400 hover:text-rose-600 shrink-0"
                  title="حذف پیوست"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        {uploadError && (
          <p className="text-[10px] text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
            {uploadError}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              data-note-file-input
              onChange={(e) => void handlePick(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || atLimit}
              className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 font-bold py-1.5 px-3 rounded-xl text-[11px] flex items-center gap-1.5 transition-all disabled:opacity-50"
              title={atLimit ? "بیشتر از این تعداد فایل روی یک یادداشت پذیرفته نمی‌شود." : "پیوست فایل"}
            >
              {uploading
                ? <Loader2 size={13} className="animate-spin" />
                : <Paperclip size={13} />}
              پیوست فایل
            </button>
            {atLimit && (
              <span className="text-[10px] text-slate-400">
                حداکثر {MAX_ACTIVITY_ATTACHMENTS.toLocaleString("fa-IR")} فایل
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!hasContent || uploading}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-1.5 px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm shadow-indigo-600/10 font-sans"
          >
            <Plus size={14} />
            ثبت یادداشت / توافق
          </button>
        </div>
      </div>

      {/*
        Notes timeline.

        **No `max-h` and no scrollbar of its own.** This block is rendered inside
        the after-sales form, which is itself `overflow-y-auto` — so a capped
        list here was a second vertical scroller nested in the only one, which is
        a window onto a list whose shape the reader cannot see. The rule is the
        one this codebase already holds for six other forms; the check that
        enforces it reads those screens and never read this component, which is
        how the fault stood on a screen the check passes.
      */}
      {notes.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
          هیچ یادداشت یا توافق خاصی برای این ماژول ثبت نشده است.
        </div>
      ) : (
        <div className="relative pr-4 border-r-2 border-slate-100 space-y-4 pl-1">
          {notes.map((note) => {
            const authorName = note.author || "کاربر سیستم";
            const attachments = note.attachments ?? [];
            return (
              <div key={note.id} className="relative group animate-fade-in">
                {/* Timeline Node */}
                <div className="absolute -right-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white shadow-sm ring-4 ring-indigo-50" />

                <div className="bg-slate-50/50 hover:bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-slate-200 transition-all space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {/*
                        The shared disc, so one colleague is one colour wherever
                        they appear and «محمد مقدم» reads «مم». This card drew its
                        own monogram from the first two *characters* of the whole
                        name, which for that name is «مح».
                      */}
                      <Avatar name={authorName} size="sm" />
                      <div className="text-right">
                        <span className="font-bold text-[11px] text-slate-800 block">
                          {authorName}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-slate-100">
                        <Calendar size={10} className="text-slate-400" />
                        {formatDateTimeToShamsi(note.createdAt)}
                      </span>
                      {/*
                        Drawn only for somebody the server will let press it. It
                        used to be drawn for everybody and answered 403, which is
                        a refusal nobody can act on.
                      */}
                      {note.canDelete !== false && (
                        <button
                          type="button"
                          onClick={() => onDeleteNote(note.id)}
                          className="text-rose-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 p-1 rounded transition-all hover:bg-rose-50"
                          title="حذف یادداشت"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {note.text && (
                    <p className="text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap">
                      {note.text}
                    </p>
                  )}

                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1" data-note-files>
                      {attachments.map((f) => (
                        <a
                          key={f.url}
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-slate-700 rounded-lg px-2 py-1 text-[10px] transition-colors max-w-full"
                          title={f.name}
                        >
                          <Paperclip size={10} className="text-slate-400 shrink-0" />
                          <span className="truncate max-w-[180px]">{f.name}</span>
                          {f.size && <span className="text-slate-400 shrink-0">{f.size}</span>}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
