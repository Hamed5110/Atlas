/**
 * Playwright → QA Agent reporter (Orchestration Fixes §2.1 Option A).
 * Writes per-project JSON: test-reports/qa-agent/playwright-{project}.json
 */
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface CaseRow {
  title: string;
  file: string;
  project: string;
  status: string;
  duration_ms: number;
  error?: string;
  retries: number;
  tags: string[];
}

class AgentReporter implements Reporter {
  private cases: CaseRow[] = [];
  private started = Date.now();
  private outputDir = join(process.cwd(), "test-reports", "qa-agent");
  private projectName = "default";

  onBegin(_config: FullConfig, suite: Suite) {
    mkdirSync(this.outputDir, { recursive: true });
    const projects = new Set<string>();
    for (const test of suite.allTests()) {
      projects.add(test.parent.project()?.name || "default");
    }
    if (projects.size === 1) {
      this.projectName = [...projects][0];
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const project = test.parent.project()?.name || "default";
    this.projectName = project;
    const tags = (test.tags || []).map((t) => String(t).replace(/^@/, ""));
    // Also pick @critical from title annotations if present
    if (/\bcritical\b/i.test(test.title) && !tags.includes("critical")) {
      tags.push("critical");
    }
    this.cases.push({
      title: test.title,
      file: test.location.file.replace(/\\/g, "/"),
      project,
      status: result.status,
      duration_ms: result.duration,
      error: result.error?.message?.split("\n")[0],
      retries: result.retry,
      tags,
    });
  }

  onEnd(result: FullResult) {
    const byProject = new Map<string, CaseRow[]>();
    for (const row of this.cases) {
      const list = byProject.get(row.project) || [];
      list.push(row);
      byProject.set(row.project, list);
    }

    const writePayload = (project: string, cases: CaseRow[]) => {
      const payload = {
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - this.started,
        status: result.status,
        project,
        cases,
        counts: {
          total: cases.length,
          passed: cases.filter((c) => c.status === "passed").length,
          failed: cases.filter((c) => c.status === "failed").length,
          skipped: cases.filter((c) => c.status === "skipped").length,
          flaky: cases.filter((c) => c.retries > 0 && c.status === "passed").length,
          timedOut: cases.filter((c) => c.status === "timedOut").length,
        },
      };
      const name = `playwright-${project}.json`;
      writeFileSync(join(this.outputDir, name), JSON.stringify(payload, null, 2));
    };

    if (byProject.size === 0) {
      writePayload(this.projectName, []);
      return;
    }
    for (const [project, cases] of byProject) {
      writePayload(project, cases);
    }
  }
}

export default AgentReporter;
