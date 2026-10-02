import { Component, type ReactNode } from 'react';

/**
 * What a screen shows when its code could not be loaded or it threw while
 * rendering. Without it React unmounts the whole application — sidebar,
 * header and all — so one broken screen became a white page with no way out.
 * The shell keys it on the active view, so choosing another module starts
 * clean rather than carrying the failure across.
 */
export default class ViewErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('View failed to render', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div data-view-error className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-lg mx-auto my-12 space-y-4" dir="rtl">
        <h2 className="text-lg font-bold text-slate-800">این بخش بارگذاری نشد</h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          ممکن است نسخهٔ جدیدی از برنامه نصب شده باشد یا اتصال قطع شده باشد. صفحه را دوباره بارگذاری کنید.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-bold hover:bg-sky-700"
        >
          بارگذاری مجدد
        </button>
      </div>
    );
  }
}
