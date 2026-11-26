"use client";

import { DocumentStudio } from "@/components/document-studio";
import { PageHeader } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n";

function ContractsPage() {
  const t = useT();
  return (
    <div className="space-y-6 animate-[fade-in_0.25s_ease-out]">
      <PageHeader
        title={t("page.contracts.title")}
        subtitle={t("page.contracts.subtitle")}
      />
      <DocumentStudio kind="contract" />
    </div>
  );
}

export default ContractsPage;
