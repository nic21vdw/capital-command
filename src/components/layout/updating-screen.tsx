import { RELEASE_STAGES, type ReleaseWatch } from "@/lib/release/shared";

export function UpdatingScreen({ watch }: { watch: ReleaseWatch | null }) {
  const stage = watch?.stage ?? 0;
  const lost = watch?.tone === "lost";
  const moving = watch?.spin ?? true;

  return (
    <main className="updating-screen">
      <section role="status" aria-live="polite" className="updating-card" data-tone={watch?.tone ?? "working"}>
        <div className={`updating-mascot${moving ? " is-moving" : ""}`} aria-hidden="true">
          <span className="updating-mascot-face">CC</span>
          <span className="updating-mascot-shadow" />
        </div>

        <h1 className="updating-title">Updating Capital Command</h1>

        <p className="updating-headline">
          <span>{watch?.label ?? "Starting the update"}</span>
          {moving && !lost ? (
            <span className="updating-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
          ) : null}
        </p>

        {watch?.elapsed ? (
          <p className="updating-elapsed"><span className="sr-only">Elapsed </span>{watch.elapsed}</p>
        ) : null}

        <ol className="updating-track" aria-label={`Step ${stage + 1} of ${RELEASE_STAGES.length}`}>
          {RELEASE_STAGES.map((name, index) => {
            const state = index < stage ? "done" : index === stage ? (lost ? "stuck" : "current") : "todo";
            return (
              <li key={name} className="updating-step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
                <span className="updating-step-dot">{state === "done" ? "✓" : index + 1}</span>
                <span className="updating-step-name">{name}</span>
              </li>
            );
          })}
        </ol>

        {moving && !lost ? (
          <span className="updating-sweep" aria-hidden="true"><i /></span>
        ) : null}

        <p className="updating-detail">{watch?.detail}</p>
      </section>
    </main>
  );
}
