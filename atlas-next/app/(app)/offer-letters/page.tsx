"use client";

import { DocumentStudio } from "@/components/document-studio";
import { PageHeader } from "@/components/ui/primitives";

function OfferLettersPage() {
  return (
    <div className="space-y-6 animate-[fade-in_0.25s_ease-out]">
      <PageHeader
        title="Offer Letters"
        subtitle="Compose print-ready employment offer letters with your company letterhead"
      />
      <DocumentStudio kind="offer_letter" />
    </div>
  );
}

export default OfferLettersPage;
