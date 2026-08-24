import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";
import { resolveUploadPath } from "../../uploadsDir";

/**
 * A customer's own documents, in something a model can read.
 *
 * An enquiry arrives as a PDF, a photographed datasheet or a spreadsheet of tag
 * numbers, and none of that is text a chat endpoint accepts. Each file is
 * turned into either extracted text or — for a picture — an image part, and
 * anything that is neither says so out loud. A file quietly ignored is worse
 * than one that was never attached: the answer looks considered and is missing
 * half the question.
 *
 * Files are read through `resolveUploadPath`, the only thing that maps a
 * `/uploads/...` URL back to a path, so a request cannot ask for a file outside
 * the uploads directory.
 */

/** Per file, so one enormous datasheet cannot become the whole prompt. */
const MAX_CHARS_PER_FILE = 20_000;
/** Across every file on one question. Tokens are money. */
const MAX_CHARS_TOTAL = 60_000;
/** A picture is sent whole; beyond this it is refused rather than truncated. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface ReadableAttachment {
  name: string;
  /** Extracted text, when the file had any. */
  text?: string;
  /** A data URI, when the file is a picture the model may look at. */
  imageDataUrl?: string;
  /** Why nothing could be read, in Persian, for the user to act on. */
  problem?: string;
}

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const TEXT_TYPES = new Set([".txt", ".md", ".csv", ".json", ".xml", ".htm", ".html"]);
const SHEET_TYPES = new Set([".xlsx", ".xls", ".xlsm"]);

function clip(text: string, limit: number): string {
  const clean = String(text ?? "").trim();
  return clean.length > limit
    ? clean.slice(0, limit) + "\n… (ادامه‌ی این فایل به دلیل طول زیاد آورده نشد)"
    : clean;
}

/** Every sheet as CSV, which is the shape a model reads most reliably. */
function readWorkbook(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb.SheetNames
    .map((name) => `--- ${name} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`)
    .join("\n\n");
}

/**
 * PDF text, or null when there is none to have.
 *
 * A scanned enquiry is a picture of a page with no text layer, and «nothing
 * readable» is the honest outcome — the alternative is a confident answer to a
 * question nobody read.
 */
async function readPdf(buffer: Buffer): Promise<string | null> {
  try {
    /*
     * Required at call time, not imported at the top.
     *
     * `pdf-parse` reads a test file bundled inside itself when it believes it is
     * the entry point, which is not something to run while bundling or on
     * startup. Reaching it this way also keeps it out of the esbuild graph.
     */
    const { createRequire } = await import("node:module");
    const requireFrom = createRequire(process.cwd() + "/package.json");
    const pdfParse = requireFrom("pdf-parse") as (b: Buffer) => Promise<{ text?: string }>;
    const parsed = await pdfParse(buffer);
    const text = String(parsed?.text ?? "").trim();
    return text || null;
  } catch (err) {
    console.error("[assistant] could not read a pdf", err);
    return null;
  }
}

async function readOne(url: string, budget: number): Promise<ReadableAttachment> {
  const filePath = resolveUploadPath(url);
  const name = decodeURIComponent(url.split("/").pop() ?? "فایل");
  if (!filePath) return { name, problem: "این فایل روی سرور پیدا نشد." };

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return { name, problem: "این فایل خوانده نشد." };
  }

  const ext = path.extname(filePath).toLowerCase();

  if (IMAGE_TYPES[ext]) {
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { name, problem: "این تصویر برای ارسال بزرگ است." };
    }
    return {
      name,
      imageDataUrl: `data:${IMAGE_TYPES[ext]};base64,${buffer.toString("base64")}`,
    };
  }

  if (ext === ".pdf") {
    const text = await readPdf(buffer);
    return text
      ? { name, text: clip(text, Math.min(MAX_CHARS_PER_FILE, budget)) }
      : {
          name,
          problem: "این PDF متن قابل استخراج ندارد (احتمالاً اسکن است)."
            + " تصویر صفحه را بفرستید یا متن را در پیام بنویسید.",
        };
  }

  if (SHEET_TYPES.has(ext)) {
    try {
      return { name, text: clip(readWorkbook(buffer), Math.min(MAX_CHARS_PER_FILE, budget)) };
    } catch {
      return { name, problem: "این فایل اکسل خوانده نشد." };
    }
  }

  if (TEXT_TYPES.has(ext)) {
    return { name, text: clip(buffer.toString("utf8"), Math.min(MAX_CHARS_PER_FILE, budget)) };
  }

  return {
    name,
    problem: `فایل با پسوند ${ext || "نامشخص"} خوانده نمی‌شود.`
      + " PDF، تصویر، اکسل یا متن بفرستید.",
  };
}

/** Reads every attachment, within one shared budget. */
export async function readAttachments(urls: string[]): Promise<ReadableAttachment[]> {
  const out: ReadableAttachment[] = [];
  let budget = MAX_CHARS_TOTAL;

  for (const url of urls.slice(0, 10)) {
    const read = await readOne(url, budget);
    if (read.text) budget -= read.text.length;
    out.push(read);
    if (budget <= 0) break;
  }
  return out;
}
