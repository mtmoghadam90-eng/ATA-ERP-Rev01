import fs from "node:fs";
import path from "node:path";

/**
 * Console output, also written to a file.
 *
 * The application runs on the server as a Scheduled Task, which has nowhere to
 * put stdout — so every `console.error` the API makes, including the one line in
 * `sendError` that says what actually went wrong, went nowhere at all. A 500
 * reaching a user was undiagnosable: the response deliberately carries a generic
 * Persian sentence rather than the database's message, and the real one existed
 * only in a stream nobody was reading.
 *
 * Deliberately not a logging library. This is a few lines that must never
 * themselves take the process down, so every write is guarded and a failure to
 * log is silent — a server that cannot write its log should still serve.
 *
 * One file per day, and files older than `KEEP_DAYS` are removed on startup, so
 * this cannot fill a shared disk.
 */

const KEEP_DAYS = 14;

let stream: fs.WriteStream | null = null;
let currentDay = "";

function directory(): string {
  return process.env.ERP_LOG_DIR || path.join(process.cwd(), "logs");
}

const dayStamp = (): string => new Date().toISOString().slice(0, 10);

/** Opens today's file, rolling over when the date changes under a long uptime. */
function streamFor(day: string): fs.WriteStream | null {
  if (stream && currentDay === day) return stream;

  try {
    const dir = directory();
    fs.mkdirSync(dir, { recursive: true });
    stream?.end();
    stream = fs.createWriteStream(path.join(dir, `app-${day}.log`), { flags: "a" });
    // A write error must not become an unhandled 'error' event, which would end
    // the process — the opposite of what a log is for.
    stream.on("error", () => { stream = null; });
    currentDay = day;
    return stream;
  } catch {
    return null;
  }
}

function removeOldFiles(): void {
  try {
    const dir = directory();
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(dir)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const file = path.join(dir, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
  } catch {
    // Nothing to clean, or no permission to. Neither is worth a word.
  }
}

/** Renders one console argument the way the terminal would. */
function render(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Stamps every physical line, not just the first.
 *
 * A Prisma error message begins with a newline and runs to a dozen lines. With
 * one stamp per *call*, the first line of the file read `[api] GET /api/x:` and
 * nothing else, and everything that said what actually happened sat on
 * following lines carrying no marker at all — so searching the log for `[api]`
 * returned a list of empty messages. Which is precisely what happened the first
 * time this log was used in anger.
 */
function prefixEveryLine(level: string, text: string): string {
  const stamp = `${new Date().toISOString()} [${level}] `;
  const body = text.replace(/\s+$/, "");
  return body.split("\n").map((line) => `${stamp}${line}`).join("\n") + "\n";
}

/**
 * Starts teeing console output to the log directory.
 *
 * Output still goes to the console as before — this adds a destination rather
 * than replacing one, so running in a terminal is unchanged.
 */
export function startFileLogging(): string | null {
  removeOldFiles();

  const target = streamFor(dayStamp());
  if (!target) return null;

  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      try {
        streamFor(dayStamp())?.write(prefixEveryLine(level, args.map(render).join(" ")));
      } catch {
        // Never let logging break the thing being logged.
      }
    };
  }

  // The two ways a Node process dies without saying anything useful.
  process.on("uncaughtException", (err) => {
    console.error("[fatal] uncaught exception:", err);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandled rejection:", reason);
  });

  return path.join(directory(), `app-${dayStamp()}.log`);
}
