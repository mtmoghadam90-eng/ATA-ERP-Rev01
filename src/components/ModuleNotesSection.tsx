import React, { useState } from "react";
import { MessageSquare, Calendar, Trash2, User, Plus } from "lucide-react";
import { getTodayShamsi } from "../dateUtils";

interface NoteItem {
  id: string;
  text: string;
  createdAt: string;
  author: string;
}

interface ModuleNotesSectionProps {
  notes?: NoteItem[];
  onAddNote: (text: string) => void;
  onDeleteNote: (id: string) => void;
  title?: string;
  placeholder?: string;
  currentUser?: { name?: string; username?: string; role?: string } | null;
}

export default function ModuleNotesSection({
  notes = [],
  onAddNote,
  onDeleteNote,
  title = "توافقات و یادداشت‌های خاص",
  placeholder = "توافق خاص، کامنت یا یادداشت جدید را اینجا بنویسید...",
  currentUser,
}: ModuleNotesSectionProps) {
  const [newNoteText, setNewNoteText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    onAddNote(newNoteText.trim());
    setNewNoteText("");
  };

  const getInitials = (name: string) => {
    if (!name) return "U";
    return name.trim().split(/\s+/).map(n => n[0]).join("").substring(0, 2);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <h4 className="font-bold text-xs md:text-sm text-slate-800 flex items-center gap-2">
          <MessageSquare size={16} className="text-indigo-500" />
          {title} ({notes.length})
        </h4>
      </div>

      {/* Add Note Form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="relative">
          <textarea
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder={placeholder}
            rows={2}
            className="w-full text-xs border border-slate-200 rounded-xl p-3 bg-slate-50/30 hover:bg-white focus:bg-white focus:border-indigo-500 transition-all resize-none outline-none leading-relaxed font-sans"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!newNoteText.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-1.5 px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-sm shadow-indigo-600/10 font-sans"
          >
            <Plus size={14} />
            ثبت یادداشت / توافق
          </button>
        </div>
      </form>

      {/* Notes List Timeline */}
      {notes.length === 0 ? (
        <div className="text-center py-6 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
          هیچ یادداشت یا توافق خاصی برای این ماژول ثبت نشده است.
        </div>
      ) : (
        <div className="relative pr-4 border-r-2 border-slate-100 space-y-4 max-h-[300px] overflow-y-auto pl-1">
          {notes.map((note) => {
            const authorName = note.author || "کاربر سیستم";
            return (
              <div key={note.id} className="relative group animate-fade-in">
                {/* Timeline Node */}
                <div className="absolute -right-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white shadow-sm ring-4 ring-indigo-50" />

                <div className="bg-slate-50/50 hover:bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-slate-200 transition-all space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {/* Avatar initials */}
                      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[10px] flex items-center justify-center">
                        {getInitials(authorName)}
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-[11px] text-slate-800 block">
                          {authorName}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-slate-100">
                        <Calendar size={10} className="text-slate-400" />
                        {note.createdAt}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteNote(note.id)}
                        className="text-rose-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 p-1 rounded transition-all hover:bg-rose-50"
                        title="حذف یادداشت"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap">
                    {note.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
