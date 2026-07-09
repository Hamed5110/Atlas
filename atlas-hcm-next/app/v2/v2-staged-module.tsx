"use client";

import { CheckCircle2, LayoutDashboard, Sparkles } from "lucide-react";
import styles from "./v2-shell.module.css";

type V2StagedModuleProps = {
  eyebrow: string;
  title: string;
  detail: string;
  statusLabel: string;
  legacyModuleCount: number;
  v2ModuleCount: number;
  liveModuleCount: number;
  nextSlice: string;
  carryForward: string[];
};

export default function V2StagedModule({
  eyebrow,
  title,
  detail,
  statusLabel,
  legacyModuleCount,
  v2ModuleCount,
  liveModuleCount,
  nextSlice,
  carryForward
}: V2StagedModuleProps) {
  return (
    <section className={styles.moduleStack} data-testid="staged-module">
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
          <span>{detail}</span>
        </div>
        <div className={styles.heroAside}>
          <div className={styles.heroPill}>Legacy parity</div>
          <strong>{statusLabel}</strong>
          <span>This `/v2` destination now exists so the shell matches the legacy screen inventory on port 3355.</span>
        </div>
      </section>

      <section className={styles.metrics}>
        <article className={styles.metricCard}>
          <small>Legacy screens on 3355</small>
          <strong>{legacyModuleCount}</strong>
          <span>Counted from the live legacy shell view matrix in `app/page.tsx`.</span>
        </article>
        <article className={styles.metricCard}>
          <small>V2 shell screens</small>
          <strong>{v2ModuleCount}</strong>
          <span>Navigation destinations now mounted in the `/v2` shell.</span>
        </article>
        <article className={styles.metricCard}>
          <small>Live migrated modules</small>
          <strong>{liveModuleCount}</strong>
          <span>Sign-in, overview, employees, and airfare are already running on live contracts.</span>
        </article>
        <article className={styles.metricCard}>
          <small>Next migration slice</small>
          <strong>{nextSlice}</strong>
          <span>Recommended next module to convert from staging into a live `/v2` workflow.</span>
        </article>
      </section>

      <section className={styles.contentGrid}>
        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            <LayoutDashboard size={18} />
            <span>Carry-forward responsibilities</span>
          </div>
          <div className={styles.checkList}>
            {carryForward.map((item) => (
              <div key={item}>
                <strong>{item}</strong>
                <small>Preserve the legacy contract and move only the presentation and interaction layer.</small>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelTitle}>
            <Sparkles size={18} />
            <span>Migration notes</span>
          </div>
          <div className={styles.timeline}>
            <div>
              <strong>Screen mounted in `/v2`</strong>
              <small>Users can now reach this destination from the new shell.</small>
            </div>
            <div>
              <strong>Backend remains untouched</strong>
              <small>No API contract, session payload, or port 3355 behavior changes in this staging layer.</small>
            </div>
            <div>
              <strong>Ready for live module pass</strong>
              <small>When selected for migration, this screen can inherit the same verified theme, shell, and clickability rules.</small>
            </div>
          </div>
        </article>
      </section>

      <article className={styles.panel}>
        <div className={styles.panelTitle}>
          <CheckCircle2 size={18} />
          <span>Verification rule</span>
        </div>
        <div className={styles.standardNote}>
          <div>
            <strong>Parity before logic rewrite</strong>
            <span>Every legacy module now needs a visible, reachable `/v2` destination before we replace the old shell. Live data migration continues module by module.</span>
          </div>
        </div>
      </article>
    </section>
  );
}
