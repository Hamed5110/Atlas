"use client";

import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { EssRequestForm } from "@/components/ess-request-form";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { FormSkeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { essActor, essLockReason } from "@/lib/ess-process";
import type { EssRequest } from "@/lib/types";

function EditEssRequestPage() {
  const id = useSearchParams().get("id") || "";
  const actor = essActor(useAuth((s) => s.me));
  const request = useQuery({
    queryKey: ["ess-request", id],
    enabled: Boolean(id),
    queryFn: () => api<EssRequest>(`/ess/requests/${id}`),
  });

  const backLink = (
    <Link href="/ess" className={buttonVariants({ variant: "outline" })} data-testid="ess-edit-back">
      Back to requests
    </Link>
  );
  if (!id || request.isError) {
    const gone = request.error instanceof ApiError && request.error.status === 404;
    return (
      <>
        <PageHeader title="Edit leave & ticket request" />
        {!id ? (
          <EmptyState title="No request selected" message="Open a request from ESS Requests and choose Edit." action={backLink} />
        ) : gone ? (
          <EmptyState
            title="Request not found"
            message="It may have been deleted. Deleted requests stay in the audit history but can't be edited."
            action={backLink}
          />
        ) : (
          <ErrorState error={request.error} onRetry={request.refetch} />
        )}
      </>
    );
  }
  if (request.isPending) return <FormSkeleton />;

  const locked = essLockReason(request.data, "edit", actor);
  if (locked) {
    return (
      <div data-testid="ess-edit-locked">
        <PageHeader title="Edit leave & ticket request" />
        <EmptyState icon={<Lock size={22} />} title="This request can't be edited" message={locked} />
        <div className="mt-4 flex justify-center">{backLink}</div>
      </div>
    );
  }
  return <EssRequestForm key={`${request.data.id}-${request.data.version}`} existing={request.data} />;
}

function EditEssRequestRoute() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <EditEssRequestPage />
    </Suspense>
  );
}

export default EditEssRequestRoute;
