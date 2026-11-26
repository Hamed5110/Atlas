"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { EssRequestForm } from "@/components/ess-request-form";
import { FormSkeleton } from "@/components/ui/skeleton";

function NewEssRequestPage() {
  const searchParams = useSearchParams();
  return <EssRequestForm initialEmployeeId={searchParams.get("employee") || ""} />;
}

function NewEssRequestRoute() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <NewEssRequestPage />
    </Suspense>
  );
}

export default NewEssRequestRoute;
