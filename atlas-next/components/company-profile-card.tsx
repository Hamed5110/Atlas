"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuthedImage, useCompanies, type CompanyBranding } from "@/lib/branding";

function CompanyLogoThumb({ company }: { company: CompanyBranding }) {
  const logo = useAuthedImage(company.has_logo ? company.logo_url : null);
  if (logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        className="h-10 w-10 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white object-contain p-0.5"
      />
    );
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] text-[var(--color-muted-foreground)]">
      <Building2 size={16} />
    </div>
  );
}

export function CompanyProfileCard() {
  const queryClient = useQueryClient();
  const companies = useCompanies();
  const list = companies.data ?? [];

  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [crNo, setCrNo] = useState("");
  const [address, setAddress] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const editLogoRef = useRef<HTMLInputElement>(null);

  const editing = list.find((c) => c.id === editingId) ?? null;
  const editLogo = useAuthedImage(
    mode === "edit" && editing?.has_logo ? editing.logo_url : null
  );

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview("");
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const resetForm = () => {
    setCode("");
    setName("");
    setCrNo("");
    setAddress("");
    setLogoFile(null);
    setEditingId(null);
    setMode("list");
    if (fileRef.current) fileRef.current.value = "";
    if (editLogoRef.current) editLogoRef.current.value = "";
  };

  const startCreate = () => {
    setEditingId(null);
    setCode("");
    setName("");
    setCrNo("");
    setAddress("");
    setLogoFile(null);
    setMode("create");
  };

  const startEdit = (company: CompanyBranding) => {
    setEditingId(company.id);
    setCode(company.code);
    setName(company.name);
    setCrNo(company.cr_no || "");
    setAddress(company.address || "");
    setLogoFile(null);
    setMode("edit");
  };

  const uploadLogo = async (companyId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    await api(`/companies/${companyId}/logo`, { method: "POST", body: form });
  };

  const createCompany = useMutation({
    mutationFn: async () => {
      const created = await api<{ id: string }>("/companies", {
        method: "POST",
        body: {
          code: code.trim().toUpperCase(),
          name: name.trim(),
          currency: "BHD",
          cr_no: crNo.trim() || null,
          address: address.trim() || null,
        },
      });
      if (logoFile) {
        await uploadLogo(created.id, logoFile);
      }
      return created;
    },
    onSuccess: () => {
      toast.success("Company created", "Saved in MSSQL" + (logoFile ? " with logo." : "."));
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      resetForm();
    },
    onError: (error) => toast.error("Create failed", errorMessage(error)),
  });

  const saveEdit = useMutation({
    mutationFn: async () => {
      if (!editingId) throw new Error("No company selected");
      await api(`/companies/${editingId}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          cr_no: crNo.trim(),
          address: address.trim(),
          currency: "BHD",
        },
      });
      if (logoFile) {
        await uploadLogo(editingId, logoFile);
      }
    },
    onSuccess: () => {
      toast.success("Company updated", "Changes saved in MSSQL.");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      resetForm();
    },
    onError: (error) => toast.error("Update failed", errorMessage(error)),
  });

  const quickUploadLogo = async (companyId: string, file: File | undefined) => {
    if (!file) return;
    try {
      await uploadLogo(companyId, file);
      toast.success("Logo saved", "Stored in MSSQL and used on print documents.");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    } catch (error) {
      toast.error("Logo upload failed", error instanceof ApiError ? error.detail : undefined);
    }
  };

  const deleteCompany = useMutation({
    mutationFn: async (companyId: string) => {
      await api(`/companies/${companyId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast.success("Company deleted", "Soft-deleted in MSSQL (deleted_at).");
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      resetForm();
    },
    onError: (error) => toast.error("Delete failed", errorMessage(error)),
  });

  const confirmDelete = (company: CompanyBranding) => {
    const ok = window.confirm(
      `Delete company “${company.name}” (${company.code})?\n\n` +
        "This soft-deletes the row in MSSQL. Blocked if employees still use it, or if it is the last company."
    );
    if (!ok) return;
    deleteCompany.mutate(company.id);
  };

  const formBusy =
    createCompany.isPending || saveEdit.isPending || deleteCompany.isPending;
  const canSubmitCreate = Boolean(code.trim() && name.trim() && !formBusy);
  const canSubmitEdit = Boolean(editingId && name.trim() && !formBusy);

  return (
    <Card data-testid="card-company-profile">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Company Profile</CardTitle>
            <CardDescription>
              Companies, CR No., address, and logos are stored in MSSQL. Use Edit, Logo, or Delete
              on each row — or Add company to create another with logo.
            </CardDescription>
          </div>
          {mode === "list" ? (
            <Button size="sm" onClick={startCreate} data-testid="btn-add-company">
              <Plus size={14} /> Add company
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={resetForm}>
              <X size={14} /> Back to list
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {mode === "list" ? (
          <>
            {(list.length === 0) ? (
              <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
                No companies yet. Click Add company to create the first one.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Logo</TH>
                    <TH>Company</TH>
                    <TH>CR No.</TH>
                    <TH>Address</TH>
                    <TH>Currency</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((company) => (
                    <TR key={company.id}>
                      <TD>
                        <CompanyLogoThumb company={company} />
                      </TD>
                      <TD>
                        <div className="font-semibold">{company.name}</div>
                        <div className="text-xs text-[var(--color-muted-foreground)]">
                          {company.code}
                          <Badge
                            className="ml-2"
                            variant={company.active ? "success" : "secondary"}
                          >
                            {company.active ? "active" : "inactive"}
                          </Badge>
                        </div>
                      </TD>
                      <TD className="text-xs">{company.cr_no || "—"}</TD>
                      <TD className="max-w-[220px] truncate text-xs">
                        {company.address || "—"}
                      </TD>
                      <TD className="text-xs">{company.currency || "BHD"}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(company)}
                            data-testid={`btn-edit-company-${company.code}`}
                          >
                            <Pencil size={14} /> Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.accept = "image/png,image/jpeg,image/webp";
                              input.onchange = () =>
                                quickUploadLogo(company.id, input.files?.[0]);
                              input.click();
                            }}
                          >
                            <Upload size={14} /> Logo
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deleteCompany.isPending || list.length <= 1}
                            onClick={() => confirmDelete(company)}
                            data-testid={`btn-delete-company-${company.code}`}
                            title={
                              list.length <= 1
                                ? "Cannot delete the last company"
                                : "Soft-delete company in MSSQL"
                            }
                          >
                            <Trash2 size={14} /> Delete
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        ) : (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {mode === "create" ? "New company" : `Edit — ${editing?.code ?? ""}`}
            </p>

            <div className="mb-4 flex flex-wrap items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-white">
                {logoPreview || (mode === "edit" && editLogo) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoPreview || editLogo}
                    alt="Logo preview"
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <Building2 size={28} className="text-[var(--color-muted-foreground)]" />
                )}
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">Company logo</p>
                <p className="mb-2 text-xs text-[var(--color-muted-foreground)]">
                  PNG, JPG, or WebP up to 2 MB — stored in MSSQL
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    (mode === "create" ? fileRef : editLogoRef).current?.click()
                  }
                  data-testid="btn-pick-company-logo"
                >
                  <Upload size={14} />{" "}
                  {logoFile || (mode === "edit" && editing?.has_logo)
                    ? "Change logo"
                    : "Choose logo"}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                />
                <input
                  ref={editLogoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company code *">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. ATLAS2"
                  disabled={mode === "edit"}
                  data-testid="input-company-code"
                />
              </Field>
              <Field label="Company name *">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Legal / display name"
                  data-testid="input-company-name"
                />
              </Field>
              <Field label="CR No.">
                <Input
                  value={crNo}
                  onChange={(e) => setCrNo(e.target.value)}
                  placeholder="Commercial registration number"
                  data-testid="input-company-cr"
                />
              </Field>
              <Field label="Currency">
                <Input value="BHD" disabled />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Address">
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Building, road, block, city, Kingdom of Bahrain"
                    data-testid="input-company-address"
                  />
                </Field>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              {mode === "create" ? (
                <Button
                  size="sm"
                  disabled={!canSubmitCreate}
                  onClick={() => createCompany.mutate()}
                  data-testid="btn-create-company"
                >
                  <Plus size={14} /> {formBusy ? "Saving…" : "Create company"}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={!canSubmitEdit}
                    onClick={() => saveEdit.mutate()}
                    data-testid="btn-save-company"
                  >
                    <Save size={14} /> {formBusy ? "Saving…" : "Save changes"}
                  </Button>
                  {editing ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={deleteCompany.isPending || list.length <= 1}
                      onClick={() => confirmDelete(editing)}
                    >
                      <Trash2 size={14} /> Delete
                    </Button>
                  ) : null}
                </>
              )}
              <Button size="sm" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <p className="text-[11px] text-[var(--color-muted-foreground)]">
          Profile fields and logo binary are stored in MSSQL <code>companies</code> (
          <code>cr_no</code>, <code>address</code>, <code>logo_data</code>). Delete is a soft-delete
          (<code>deleted_at</code>). The AI Data Agent also learns this in its product knowledge
          store. Offer letters use the company selected on the document screen.
        </p>
      </CardContent>
    </Card>
  );
}
