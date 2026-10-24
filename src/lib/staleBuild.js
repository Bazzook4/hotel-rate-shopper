/**
 * Telling a "this tab is from an older release" crash apart from a real one.
 *
 * Each page's code is fetched the first time it is opened. A release
 * replaces those files, so a tab left open across a release asks for a file
 * that no longer exists and the page fails to load. Reloading picks up the
 * new release and fixes it, so that is what we do, once.
 */

const RELOAD_KEY = "stale-build-reload-at";
// A second failure this soon after a reload is not a stale tab; stop
// reloading so a real fault cannot loop the page forever.
const RELOAD_GAP_MS = 30_000;

export function isStaleBuildError(error) {
  if (!error) return false;
  const text = `${error.name || ""} ${error.message || ""}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
    text
  );
}

/** Reloads the page unless it was just reloaded for the same reason. */
export function reloadForNewRelease() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Without storage there is no loop guard, so do not reload on our own.
    return false;
  }
  window.location.reload();
  return true;
}
