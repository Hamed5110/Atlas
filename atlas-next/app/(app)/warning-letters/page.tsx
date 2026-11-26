"use client";

import { HrLifecyclePageShell } from "@/components/hr-lifecycle-studio";

export default function WarningLettersPage() {
  return (
    <HrLifecyclePageShell
      kind="warning_letter"
      title="Warning Letters"
      subtitle="1st notice and final warning letters with incident details and optional PIP reference"
    />
  );
}
