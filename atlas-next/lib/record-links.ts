/** Where a dashboard row goes: the one record, not the whole list. */

export function ticketDocumentPath(ticketId: string): string {
  return `/allocation?ticket=${encodeURIComponent(ticketId)}&view=documents`;
}

export function employeeRecordPath(employeeId: string): string {
  return `/employees?edit=${encodeURIComponent(employeeId)}`;
}

export function loanRecordPath(loanId: string): string {
  return `/loans?loan=${encodeURIComponent(loanId)}`;
}

export function essRequestPath(requestId: string): string {
  return `/ess?request=${encodeURIComponent(requestId)}`;
}
