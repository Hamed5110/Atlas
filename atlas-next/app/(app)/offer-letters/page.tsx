"use client";

import { DocumentStudio } from "@/components/document-studio";
import { PageHeader } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n";

function OfferLettersPage() {
  const t = useT();
  return (
    <div className="space-y-6 animate-[fade-in_0.25s_ease-out]">
      <PageHeader
        title={t("page.offerLetters.title")}
        subtitle={t("page.offerLetters.subtitle")}
      />
      <DocumentStudio kind="offer_letter" />
    </div>
  );
}

export default OfferLettersPage;
