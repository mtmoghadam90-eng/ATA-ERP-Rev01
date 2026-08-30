import { useEffect, useState } from "react";
import {
  HolidayCalendarState, ensureHolidayCalendar, holidayCalendarState, onHolidayCalendarChange,
} from "./holidays";

/**
 * The official calendar, for a screen that draws it.
 *
 * Two jobs, and the second is why this exists rather than a bare
 * `ensureHolidayCalendar()` call. It makes sure the days are loaded — and it
 * **repaints when they land**. `isOfficialHoliday` reads a copy held in the
 * date helpers, so a calendar rendered before the fetch resolved has nothing
 * telling it to draw again: it would show a month of unbroken working days
 * until some unrelated state change happened to re-render it.
 *
 * It also reports what is actually loaded, so a screen can tell «this year has
 * no holidays stored» from «the calendar has not arrived» — two states that
 * look identical on a grid and mean completely different things.
 */
export function useHolidayCalendar(): HolidayCalendarState {
  const [state, setState] = useState<HolidayCalendarState>(holidayCalendarState);

  useEffect(() => {
    // The unsubscribe is registered first, so a fetch that resolves during
    // this effect is not missed.
    const stop = onHolidayCalendarChange(() => setState(holidayCalendarState()));
    void ensureHolidayCalendar().then(() => setState(holidayCalendarState()));
    return stop;
  }, []);

  return state;
}
