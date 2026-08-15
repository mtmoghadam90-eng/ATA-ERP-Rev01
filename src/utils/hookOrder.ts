/**
 * Finding hooks that only run some of the time.
 *
 * React identifies a hook by the order it was called in, so every render of a
 * component has to call the same hooks in the same sequence. A hook placed
 * *below* an early return breaks that: the branch that returns early skips it,
 * and the render where the branch stops being taken calls a hook that was not
 * there before. React's answer is to tear the whole tree down — "Rendered more
 * hooks than during the previous render" — which the user sees as a white page.
 *
 * This shipped. `useBrowserTab` was written next to the value it reads, which
 * sits under `App`'s early return for the login screen, so it ran for a signed-
 * in user and not for a signed-out one. Every sign-in therefore crashed the
 * application, on the one path every user takes.
 *
 * Nothing in this project could have caught it. A hook is an ordinary function
 * call, so the type-checker is content; no derived figure is wrong, so the rules
 * tests are content; every endpoint answers correctly, so the API tests are
 * content. There is no ESLint here, and `react-hooks/rules-of-hooks` is the
 * thing that would normally say so.
 *
 * So this reads the source. It is deliberately narrow — it looks only for a
 * `useSomething(` call that appears after a `return` at a component function's
 * own top level, which is exactly the shape of the bug and nothing else. A
 * `return` nested inside an `if`, a loop or a callback is not counted, because
 * those are not early returns from the component.
 */

export interface HookOrderProblem {
  file: string;
  /** The component the hook is inside. */
  component: string;
  hook: string;
  /** 1-based, for a clickable location. */
  line: number;
}

/** `useThing(` — a hook call, by React's own naming rule. */
const HOOK_CALL = /\buse[A-Z][A-Za-z0-9_]*\s*\(/;

/**
 * A component or custom-hook declaration.
 *
 * Both matter: a custom hook has exactly the same obligation as a component,
 * and `useBrowserTab` is one.
 */
const DECLARATION =
  /^\s*(?:export\s+(?:default\s+)?)?function\s+([A-Z][A-Za-z0-9_]*|use[A-Z][A-Za-z0-9_]*)\s*\(/;

/** Strips the strings and comments that would otherwise look like code. */
function scrub(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/**
 * Whether an opening brace starts a function body rather than a plain block.
 *
 * This is the distinction the whole check turns on. A `return` inside an `if`
 * leaves the component; a `return` inside a callback does not. Judged from the
 * text before the brace: an arrow, the `function` keyword, or a method head.
 */
function opensFunction(before: string): boolean {
  return /=>\s*$/.test(before)
    || /\bfunction\b[^{]*$/.test(before)
    || /\)\s*$/.test(before) && /\b(?:function|=>)\b/.test(before);
}

export function findHooksAfterEarlyReturn(file: string, source: string): HookOrderProblem[] {
  const lines = source.split("\n");
  const problems: HookOrderProblem[] = [];

  let component: string | null = null;
  /** One entry per open brace: true when it opened a function body. */
  let stack: boolean[] = [];
  let returned = false;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let text = lines[i];

    if (inBlockComment) {
      const close = text.indexOf("*/");
      if (close === -1) continue;
      text = text.slice(close + 2);
      inBlockComment = false;
    }
    for (;;) {
      const open = text.indexOf("/*");
      if (open === -1) break;
      const close = text.indexOf("*/", open + 2);
      if (close === -1) { text = text.slice(0, open); inBlockComment = true; break; }
      text = text.slice(0, open) + " " + text.slice(close + 2);
    }

    const code = scrub(text);
    if (!code.trim()) continue;

    if (component === null) {
      const match = DECLARATION.exec(code);
      if (!match) continue;
      component = match[1];
      stack = [];
      returned = false;

      /*
       * Start counting at the brace that opens the body.
       *
       * A signature carries braces of its own — destructured props, an inline
       * prop type — and counting those puts the whole stack out by two, which
       * silently disables the check for most components. The body's brace is
       * the last one on the declaration line.
       */
      const body = code.lastIndexOf("{");
      if (body === -1) continue;
      stack.push(true);
      const rest = code.slice(body + 1);
      for (const ch of rest) {
        if (ch === "{") stack.push(false);
        else if (ch === "}") stack.pop();
      }
      continue;
    }

    /*
     * A `return` that leaves the component, and a hook called directly in its
     * body, are both judged before this line's braces are applied — the hook
     * call and the brace that follows it are on the same line often enough to
     * matter.
     */
    const insideCallback = stack.slice(1).some(Boolean);
    const atBodyLevel = stack.length === 1 && !insideCallback;

    // An early return: one inside a branch of the body, not the body's own
    // final `return`, which nothing can follow.
    if (stack.length > 1 && !insideCallback && /(^|[;{}\s])return\b/.test(code)) {
      returned = true;
    }

    if (returned && atBodyLevel && HOOK_CALL.test(code)) {
      const hook = HOOK_CALL.exec(code)?.[0].replace(/\s*\($/, "") ?? "use?";
      problems.push({ file, component, hook, line: i + 1 });
    }

    // Apply this line's braces, remembering what each one opened.
    for (let c = 0; c < code.length; c++) {
      if (code[c] === "{") stack.push(opensFunction(code.slice(0, c)));
      else if (code[c] === "}") {
        stack.pop();
        if (stack.length === 0) { component = null; returned = false; break; }
      }
    }
  }

  return problems;
}
