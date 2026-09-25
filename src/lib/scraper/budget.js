/**
 * Fitting a slow sweep into a request that must return quickly.
 *
 * Reading Google's page takes about five seconds per stay date, plus a
 * randomised pause between fetches so a sweep does not read as automated.
 * A week of parity is therefore around a minute and six competitors across a
 * week is several, while the platform kills a request at sixty seconds.
 *
 * Rather than shrink the window the hotelier asked for, a refresh does as
 * much as it can inside a safe budget, saves it, and says where it stopped.
 * The client calls again from there until the sweep is finished, so the work
 * is unchanged and only the number of requests it takes differs.
 */

/**
 * How long a refresh may spend before returning.
 *
 * Deliberately short of the platform's own limit: the budget is checked
 * *before* starting a fetch, so the request still has to finish whatever it
 * last began. One fetch is about five seconds and a slow one can reach the
 * 45s timeout in `fetch.js`, so the gap is what keeps a batch from being
 * killed mid-save and losing the rows it had already gathered.
 */
const DEFAULT_BUDGET_MS = 40000;

/** A slow fetch plus its pause, used to decide if another one fits. */
const ESTIMATED_STEP_MS = 14000;

/**
 * Tracks how much of a request's time is left.
 *
 * `canContinue()` answers whether there is room for another fetch, not
 * whether any time remains: stopping with a little unused budget is the point,
 * since the alternative is being killed mid-write.
 */
export function createBudget({ budgetMs = DEFAULT_BUDGET_MS, stepMs = ESTIMATED_STEP_MS } = {}) {
  const startedAt = Date.now();

  return {
    elapsed() {
      return Date.now() - startedAt;
    },
    /** Room for at least one more fetch? */
    canContinue() {
      return Date.now() - startedAt + stepMs < budgetMs;
    },
  };
}

/**
 * Where a partial sweep stopped, in a form the client can send straight back.
 *
 * `null` means finished. Anything else is the index of the next unit of work,
 * which the caller turns into whatever its own loop needs -- a date offset
 * for parity, a competitor-and-date pair for the competitor grid.
 */
export function cursorFrom(index, total) {
  return index >= total ? null : index;
}
