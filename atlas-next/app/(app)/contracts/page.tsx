"use client";

import { DocumentStudio } from "@/components/document-studio";
import { PageHeader } from "@/components/ui/primitives";

function ContractsPage() {
  return (
    <div className="space-y-6 animate-[fade-in_0.25s_ease-out]">
      <PageHeader
        title="Employment Contracts"
        subtitle="Generate employment contracts referencing the current airfare policy"
      />
      <DocumentStudio kind="contract" />
    </div>
  );
}

export default ContractsPage;
