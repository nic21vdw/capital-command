/** Poll UI data only while visible, with at most one read in flight. */
export function pollWhileVisible(read: () => Promise<void>, intervalMs: number): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refreshOnReturn = false;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const finished = () => {
    running = false;
    if (stopped || document.hidden) return;
    if (refreshOnReturn) {
      refreshOnReturn = false;
      run();
    } else {
      timer = setTimeout(run, intervalMs);
    }
  };
  const run = () => {
    clear();
    if (stopped || document.hidden || running) return;
    running = true;
    refreshOnReturn = false;
    // Readers present their own failure state. A rejected read still releases
    // the slot so the next scheduled refresh can recover.
    void Promise.resolve().then(() => {
      if (!stopped && !document.hidden) return read();
    }).then(finished, finished);
  };
  const visibilityChanged = () => {
    clear();
    if (document.hidden) return;
    if (running) refreshOnReturn = true;
    else run();
  };
  document.addEventListener("visibilitychange", visibilityChanged);
  run();
  return () => {
    stopped = true;
    clear();
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
