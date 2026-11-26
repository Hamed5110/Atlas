"use client";

import { HrLifecyclePageShell } from "@/components/hr-lifecycle-studio";

export default function SalaryRevisionsPage() {
  return (
    <HrLifecyclePageShell
      kind="salary_increment"
      title="Salary Revisions"
      subtitle="Incremental / revision letters with before–after component breakdown"
    />
  );
}
