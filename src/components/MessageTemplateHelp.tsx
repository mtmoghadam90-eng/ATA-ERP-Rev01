import {
  CHANNELS, Channel, MESSAGE_VARIABLES, SAMPLE_VARIABLE_VALUES,
  renderTemplate, templateVariables,
} from '../utils/messaging';

/**
 * The two things a person writing or choosing a message template needs, drawn
 * by one component in both places they appear.
 *
 * The messaging module's template editor and the workflow rule editor sit in
 * different modules and ask about the same text, so a second copy here is a
 * second answer to «what will the customer actually read» — the fault this
 * codebase keeps repairing. Both read `MESSAGE_VARIABLES` and `renderTemplate`,
 * which is what makes it impossible for a variable the server started filling
 * in to be offered on one screen and unknown on the other.
 */

/**
 * The message as the customer will read it, with the sample values in place.
 *
 * The rule editor used to print the template **raw**, so a person picking one
 * saw «سلام {{addressee}} عزیز» and had to hold the substitution in their head
 * — which is exactly what they are choosing a template to avoid thinking about.
 *
 * But a preview alone is worse than the raw text in one specific way, and that
 * is why the variables are named beneath it: rendered, «جناب آقای مهندس رضایی»
 * is indistinguishable from those words typed in by hand, so somebody reads a
 * sample name as the real one. The list says which parts move.
 */
export function TemplatePreview({
  body,
  subject,
  channel,
}: {
  body: string | null | undefined;
  subject?: string | null;
  channel?: Channel | string | null;
}) {
  const bodyText = renderTemplate(body, SAMPLE_VARIABLE_VALUES);
  const subjectText = renderTemplate(subject, SAMPLE_VARIABLE_VALUES);
  const used = templateVariables(body);

  return (
    <div className="space-y-1.5">
      <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 space-y-1">
        {channel === CHANNELS.EMAIL && (
          <div className="text-[11px] text-emerald-900 border-b border-emerald-100 pb-1.5">
            <span className="font-bold">موضوع: </span>
            {subjectText || <span className="text-emerald-700/60">—</span>}
          </div>
        )}
        <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
          {bodyText || <span className="text-slate-400">هنوز متنی نوشته نشده است.</span>}
        </div>
      </div>
      {used.length > 0 && (
        <p className="text-[10px] text-slate-500">
          مقادیر بالا نمونه‌اند؛ این بخش‌ها هنگام ارسال جایگزین می‌شوند:{' '}
          <span className="font-mono text-sky-700" dir="ltr">{used.join(' · ')}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The variables a template may use, as chips that insert themselves.
 *
 * Drawn from the same list the server fills in rather than typed out at a call
 * site — that is how `namePrefix` came to exist without the people writing
 * templates ever being told about it.
 *
 * It belongs wherever a template is **written** and nowhere a template is only
 * **chosen**: the workflow rule editor picks an existing one, and a palette
 * there would offer to insert a variable into a box that does not exist.
 */
export function TemplateVariablePalette({ onInsert }: { onInsert: (key: string) => void }) {
  return (
    <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-150 rounded-lg px-2 py-2 space-y-1.5">
      <div className="font-bold">متغیرهای در دسترس (برای درج، روی هرکدام کلیک کنید):</div>
      <div className="flex flex-wrap gap-1">
        {MESSAGE_VARIABLES.map((variable) => (
          <button
            key={variable.key}
            type="button"
            title={`${variable.label} — مثال: ${variable.sample}`}
            onClick={() => onInsert(variable.key)}
            className="font-mono bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 hover:border-sky-300 hover:text-sky-700"
            dir="ltr"
          >
            {variable.key}
          </button>
        ))}
      </div>
      <p>
        «پیشوند نام» برای مرد «جناب آقای مهندس» و برای زن «سرکار خانم مهندس» است و
        برای شرکت یا مشتری بدون جنسیت خالی می‌ماند؛ در آن حالت از «addressee» استفاده
        کنید تا فاصله‌ی اضافی در متن نیفتد.
      </p>
    </div>
  );
}
