"use client";

/**
 * HR Form Schema Builder — self-serve print layout per field.
 * Users expand a field → set zone / width / align / format / etc., or apply a preset.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorState, PageHeader } from "@/components/ui/primitives";
import { TableSkeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api";
import { canManage, useAuth } from "@/lib/auth";

interface FormField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  active?: boolean;
  options?: string[];
  sort_order?: number;
  deleted_at?: string | null;
  print_zone?: string;
  print_after?: string | null;
  print_align?: string;
  print_width?: string;
  print_label_pos?: string;
  print_bold?: boolean;
  print_show_label?: boolean;
  print_format?: string;
  print_prefix?: string;
  print_suffix?: string;
  print_size?: string;
  print_vspace?: string;
  print_border?: string;
  print_italic?: boolean;
  print_show_empty?: boolean;
  print_indent?: string;
  print_label_width?: string;
  print_hline?: boolean;
  print_role?: "field" | "section" | "spacer" | "static";
  print_color?: "default" | "muted" | "emphasis" | "danger";
  print_line_height?: "compact" | "normal" | "relaxed";
  print_bg?: "none" | "tint" | "shade";
  print_page_break?: boolean;
  print_static_text?: string;
  print_include?: boolean;
  print_label_bold?: boolean;
  print_keep_together?: boolean;
  print_empty_as?: "dash" | "blank" | "na" | "pending";
}

interface FormDef {
  id: string;
  kind: string;
  name: string;
  description: string;
  fields: FormField[];
  version: number;
  template_bound_keys?: string[];
}

interface Opt {
  key: string;
  label: string;
}

interface PrintPreset {
  key: string;
  label: string;
  patch: Partial<FormField>;
}

interface FormsResponse {
  forms: FormDef[];
  template_bound_by_kind?: Record<string, string[]>;
  print_zones?: Opt[];
  print_aligns?: Opt[];
  print_widths?: Opt[];
  print_label_positions?: Opt[];
  print_formats?: Opt[];
  print_sizes?: Opt[];
  print_vspaces?: Opt[];
  print_borders?: Opt[];
  print_indents?: Opt[];
  print_label_widths?: Opt[];
  print_roles?: Opt[];
  print_colors?: Opt[];
  print_line_heights?: Opt[];
  print_bgs?: Opt[];
  print_empty_as?: Opt[];
  print_presets?: PrintPreset[];
}

const FIELD_TYPES = ["text", "textarea", "number", "date", "dropdown", "file", "signature"];

const FALLBACK = {
  print_zones: [
    { key: "header", label: "Header (after To / before intro)" },
    { key: "particulars", label: "Particulars (main details table)" },
    { key: "middle", label: "Middle (after particulars)" },
    { key: "footer", label: "Footer (before signatures)" },
    { key: "signatures", label: "Signatures (near signature lines)" },
    { key: "hidden", label: "Hidden (form only — not on PDF)" },
  ],
  print_aligns: [
    { key: "left", label: "Align left" },
    { key: "center", label: "Align center" },
    { key: "right", label: "Align right (amounts)" },
    { key: "justify", label: "Justify (paragraphs)" },
  ],
  print_widths: [
    { key: "full", label: "Full row (100%)" },
    { key: "half", label: "Half row (50%)" },
    { key: "third", label: "Third row (33%)" },
    { key: "quarter", label: "Quarter row (25%)" },
  ],
  print_label_positions: [
    { key: "beside", label: "Label beside value" },
    { key: "above", label: "Label above value" },
    { key: "value_only", label: "Value only" },
    { key: "label_only", label: "Label only (heading)" },
  ],
  print_formats: [
    { key: "plain", label: "Plain text" },
    { key: "currency", label: "Currency (BHD)" },
    { key: "percent", label: "Percent (n%)" },
    { key: "date_long", label: "Long date" },
    { key: "date_short", label: "Short date" },
    { key: "uppercase", label: "UPPERCASE" },
    { key: "lowercase", label: "lowercase" },
    { key: "title", label: "Title Case" },
    { key: "yes_no", label: "Yes / No" },
    { key: "multiline", label: "Keep line breaks" },
  ],
  print_sizes: [
    { key: "small", label: "Small type" },
    { key: "normal", label: "Normal type" },
    { key: "large", label: "Large type" },
    { key: "xlarge", label: "Extra large" },
  ],
  print_vspaces: [
    { key: "tight", label: "Tight spacing" },
    { key: "normal", label: "Normal spacing" },
    { key: "loose", label: "Loose spacing" },
    { key: "section", label: "Section gap" },
  ],
  print_borders: [
    { key: "none", label: "No border" },
    { key: "underline", label: "Underline value" },
    { key: "box", label: "Boxed value" },
    { key: "top", label: "Top rule" },
    { key: "bottom", label: "Bottom rule" },
  ],
  print_indents: [
    { key: "none", label: "No indent" },
    { key: "indent", label: "Indent once" },
    { key: "double", label: "Indent twice" },
  ],
  print_label_widths: [
    { key: "narrow", label: "Narrow label col" },
    { key: "normal", label: "Normal label col" },
    { key: "wide", label: "Wide label col" },
  ],
  print_roles: [
    { key: "field", label: "Data field" },
    { key: "section", label: "Section break" },
    { key: "spacer", label: "Vertical spacer" },
    { key: "static", label: "Static text" },
  ],
  print_colors: [
    { key: "default", label: "Default ink" },
    { key: "muted", label: "Muted gray" },
    { key: "emphasis", label: "Emphasis dark" },
    { key: "danger", label: "Alert red" },
  ],
  print_line_heights: [
    { key: "compact", label: "Compact" },
    { key: "normal", label: "Normal" },
    { key: "relaxed", label: "Relaxed" },
  ],
  print_bgs: [
    { key: "none", label: "No background" },
    { key: "tint", label: "Light tint" },
    { key: "shade", label: "Shaded band" },
  ],
  print_empty_as: [
    { key: "dash", label: "Show as — (dash)" },
    { key: "blank", label: "Leave blank" },
    { key: "na", label: "Show as N/A" },
    { key: "pending", label: "Show as Pending" },
  ],
  print_presets: [
    {
      key: "detail_row",
      label: "Detail row (label | value)",
      patch: {
        print_zone: "particulars",
        print_width: "full",
        print_align: "left",
        print_label_pos: "beside",
        print_format: "plain",
        print_size: "normal",
        print_vspace: "normal",
        print_border: "none",
        print_indent: "none",
        print_label_width: "normal",
        print_bold: false,
        print_italic: false,
        print_hline: false,
      },
    },
    {
      key: "amount_right",
      label: "Amount (right · currency · half)",
      patch: {
        print_zone: "particulars",
        print_width: "half",
        print_align: "right",
        print_label_pos: "beside",
        print_format: "currency",
        print_size: "normal",
        print_bold: true,
        print_prefix: "BHD ",
        print_label_width: "narrow",
      },
    },
    {
      key: "section_heading",
      label: "Section heading",
      patch: {
        print_role: "section",
        print_zone: "particulars",
        print_width: "full",
        print_align: "left",
        print_label_pos: "label_only",
        print_format: "uppercase",
        print_size: "large",
        print_vspace: "section",
        print_border: "bottom",
        print_indent: "none",
        print_bold: true,
        print_italic: false,
        print_show_empty: true,
        print_hline: true,
        print_page_break: false,
        print_color: "emphasis",
        print_bg: "none",
      },
    },
    {
      key: "spacer_block",
      label: "Vertical spacer",
      patch: {
        print_role: "spacer",
        print_zone: "particulars",
        print_width: "full",
        print_vspace: "section",
        print_show_empty: true,
      },
    },
    {
      key: "static_legal",
      label: "Static legal line",
      patch: {
        print_role: "static",
        print_zone: "footer",
        print_width: "full",
        print_align: "justify",
        print_label_pos: "value_only",
        print_size: "small",
        print_italic: true,
        print_color: "muted",
        print_static_text: "This notice is issued under company policy and applicable labour law.",
        print_show_empty: true,
      },
    },
    {
      key: "body_paragraph",
      label: "Body paragraph (value only)",
      patch: {
        print_zone: "middle",
        print_width: "full",
        print_align: "justify",
        print_label_pos: "value_only",
        print_format: "multiline",
        print_vspace: "loose",
        print_line_height: "relaxed",
      },
    },
    {
      key: "page_break_before",
      label: "Start on new page",
      patch: {
        print_role: "section",
        print_zone: "middle",
        print_page_break: true,
        print_label_pos: "label_only",
        print_show_empty: true,
        print_size: "large",
        print_format: "uppercase",
      },
    },
    {
      key: "footer_note",
      label: "Footer note (small · italic)",
      patch: {
        print_zone: "footer",
        print_width: "full",
        print_label_pos: "value_only",
        print_size: "small",
        print_italic: true,
        print_indent: "indent",
        print_vspace: "tight",
        print_color: "muted",
      },
    },
    {
      key: "signature_note",
      label: "Signature note",
      patch: {
        print_zone: "signatures",
        print_width: "half",
        print_align: "center",
        print_label_pos: "above",
        print_size: "small",
        print_border: "underline",
      },
    },
    {
      key: "hidden_form_only",
      label: "Hidden (form only)",
      patch: { print_zone: "hidden" },
    },
  ] as PrintPreset[],
};

const emptyNew = (): FormField => ({
  key: "",
  label: "",
  type: "text",
  required: false,
  print_zone: "particulars",
  print_after: "",
  print_align: "left",
  print_width: "full",
  print_label_pos: "beside",
  print_bold: false,
  print_show_label: true,
  print_format: "plain",
  print_prefix: "",
  print_suffix: "",
  print_size: "normal",
  print_vspace: "normal",
  print_border: "none",
  print_italic: false,
  print_show_empty: false,
  print_indent: "none",
  print_label_width: "normal",
  print_hline: false,
  print_role: "field",
  print_color: "default",
  print_line_height: "normal",
  print_bg: "none",
  print_page_break: false,
  print_static_text: "",
  print_include: false,
  print_label_bold: false,
  print_keep_together: true,
  print_empty_as: "dash",
});

/** Print_* defaults from emptyNew — used by Reset print defaults. */
function printDefaults(): Partial<FormField> {
  const e = emptyNew();
  return {
    print_zone: e.print_zone,
    print_after: e.print_after,
    print_align: e.print_align,
    print_width: e.print_width,
    print_label_pos: e.print_label_pos,
    print_bold: e.print_bold,
    print_show_label: e.print_show_label,
    print_format: e.print_format,
    print_prefix: e.print_prefix,
    print_suffix: e.print_suffix,
    print_size: e.print_size,
    print_vspace: e.print_vspace,
    print_border: e.print_border,
    print_italic: e.print_italic,
    print_show_empty: e.print_show_empty,
    print_indent: e.print_indent,
    print_label_width: e.print_label_width,
    print_hline: e.print_hline,
    print_role: e.print_role,
    print_color: e.print_color,
    print_line_height: e.print_line_height,
    print_bg: e.print_bg,
    print_page_break: e.print_page_break,
    print_static_text: e.print_static_text,
    print_include: e.print_include,
    print_label_bold: e.print_label_bold,
    print_keep_together: e.print_keep_together,
    print_empty_as: e.print_empty_as,
  };
}

function optList(api: Opt[] | undefined, fallback: Opt[]) {
  return api?.length ? api : fallback;
}

function PrintControls({
  value,
  onChange,
  fields,
  catalogs,
  showKey = false,
  writable,
  templateBound = false,
  onResetPrintDefaults,
}: {
  value: FormField & { print_after?: string | null };
  onChange: (patch: Partial<FormField>) => void;
  fields: FormField[];
  catalogs: {
    zones: Opt[];
    aligns: Opt[];
    widths: Opt[];
    labelPos: Opt[];
    formats: Opt[];
    sizes: Opt[];
    vspaces: Opt[];
    borders: Opt[];
    indents: Opt[];
    labelWidths: Opt[];
    roles: Opt[];
    colors: Opt[];
    lineHeights: Opt[];
    bgs: Opt[];
    emptyAs: Opt[];
    presets: PrintPreset[];
  };
  showKey?: boolean;
  writable: boolean;
  templateBound?: boolean;
  onResetPrintDefaults?: () => void;
}) {
  const afterVal = value.print_after ?? "";
  return (
    <div className="space-y-3" data-testid="print-layout-controls">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Quick preset">
          <Select
            value=""
            disabled={!writable}
            data-testid="select-print-preset"
            onChange={(e) => {
              const preset = catalogs.presets.find((p) => p.key === e.target.value);
              if (preset) onChange(preset.patch);
            }}
          >
            <option value="">— apply a layout preset —</option>
            {catalogs.presets.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {writable && onResetPrintDefaults ? (
          <Button
            type="button"
            variant="outline"
            data-testid="btn-reset-print-defaults"
            onClick={onResetPrintDefaults}
          >
            Reset print defaults
          </Button>
        ) : null}
      </div>

      {templateBound ? (
        <p className="rounded-[var(--radius-sm)] bg-[var(--brand-50)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
          Already in letter template — enable &lsquo;Also print in zone&rsquo; to add a second print
          placement
        </p>
      ) : null}

      {showKey ? (
        <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Key *">
            <Input
              value={value.key}
              placeholder="custom_field"
              disabled={!writable}
              onChange={(e) => onChange({ key: e.target.value })}
            />
          </Field>
          <Field label="Label *">
            <Input
              value={value.label}
              placeholder="Custom field"
              disabled={!writable}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </Field>
          <Field label="Type">
            <Select
              value={value.type}
              disabled={!writable}
              onChange={(e) => onChange({ type: e.target.value })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Required">
            <Select
              value={value.required ? "1" : "0"}
              disabled={!writable}
              onChange={(e) => onChange({ required: e.target.value === "1" })}
            >
              <option value="0">Optional</option>
              <option value="1">Required</option>
            </Select>
          </Field>
        </div>
      ) : null}

      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Placement on PDF
      </p>
      <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Print zone *">
          <Select
            value={value.print_zone || "particulars"}
            disabled={!writable}
            data-testid="select-new-print-zone"
            onChange={(e) => onChange({ print_zone: e.target.value })}
          >
            {catalogs.zones.map((z) => (
              <option key={z.key} value={z.key}>
                {z.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="After field">
          <Select
            value={afterVal}
            disabled={!writable}
            data-testid="select-new-print-after"
            onChange={(e) => onChange({ print_after: e.target.value || null })}
          >
            <option value="">— end of zone —</option>
            {fields
              .filter((f) => f.key !== value.key)
              .map((f) => (
                <option key={f.key} value={f.key}>
                  after {f.key}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Row width">
          <Select
            value={value.print_width || "full"}
            disabled={!writable}
            data-testid="select-new-print-width"
            onChange={(e) => onChange({ print_width: e.target.value })}
          >
            {catalogs.widths.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Value alignment">
          <Select
            value={value.print_align || "left"}
            disabled={!writable}
            data-testid="select-new-print-align"
            onChange={(e) => onChange({ print_align: e.target.value })}
          >
            {catalogs.aligns.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Indent">
          <Select
            value={value.print_indent || "none"}
            disabled={!writable}
            data-testid="select-new-print-indent"
            onChange={(e) => onChange({ print_indent: e.target.value })}
          >
            {catalogs.indents.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Print role">
          <Select
            value={value.print_role || "field"}
            disabled={!writable}
            data-testid="select-new-print-role"
            onChange={(e) =>
              onChange({ print_role: e.target.value as FormField["print_role"] })
            }
          >
            {catalogs.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
        Appearance
      </p>
      <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Label position">
          <Select
            value={value.print_label_pos || "beside"}
            disabled={!writable}
            onChange={(e) => onChange({ print_label_pos: e.target.value })}
          >
            {catalogs.labelPos.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Label width">
          <Select
            value={value.print_label_width || "normal"}
            disabled={!writable}
            data-testid="select-new-print-label-width"
            onChange={(e) => onChange({ print_label_width: e.target.value })}
          >
            {catalogs.labelWidths.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Value format">
          <Select
            value={value.print_format || "plain"}
            disabled={!writable}
            onChange={(e) => onChange({ print_format: e.target.value })}
          >
            {catalogs.formats.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Empty display">
          <Select
            value={value.print_empty_as || "dash"}
            disabled={!writable}
            data-testid="select-print-empty-as"
            onChange={(e) =>
              onChange({ print_empty_as: e.target.value as FormField["print_empty_as"] })
            }
          >
            {catalogs.emptyAs.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type size">
          <Select
            value={value.print_size || "normal"}
            disabled={!writable}
            data-testid="select-new-print-size"
            onChange={(e) => onChange({ print_size: e.target.value })}
          >
            {catalogs.sizes.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vertical space">
          <Select
            value={value.print_vspace || "normal"}
            disabled={!writable}
            data-testid="select-new-print-vspace"
            onChange={(e) => onChange({ print_vspace: e.target.value })}
          >
            {catalogs.vspaces.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Value border">
          <Select
            value={value.print_border || "none"}
            disabled={!writable}
            data-testid="select-new-print-border"
            onChange={(e) => onChange({ print_border: e.target.value })}
          >
            {catalogs.borders.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prefix">
          <Input
            value={value.print_prefix || ""}
            placeholder="BHD "
            disabled={!writable}
            onChange={(e) => onChange({ print_prefix: e.target.value })}
          />
        </Field>
        <Field label="Suffix">
          <Input
            value={value.print_suffix || ""}
            placeholder=" %"
            disabled={!writable}
            onChange={(e) => onChange({ print_suffix: e.target.value })}
          />
        </Field>
        <Field label="Color">
          <Select
            value={value.print_color || "default"}
            disabled={!writable}
            data-testid="select-new-print-color"
            onChange={(e) =>
              onChange({ print_color: e.target.value as FormField["print_color"] })
            }
          >
            {catalogs.colors.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Line height">
          <Select
            value={value.print_line_height || "normal"}
            disabled={!writable}
            data-testid="select-new-print-line-height"
            onChange={(e) =>
              onChange({ print_line_height: e.target.value as FormField["print_line_height"] })
            }
          >
            {catalogs.lineHeights.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Background">
          <Select
            value={value.print_bg || "none"}
            disabled={!writable}
            data-testid="select-new-print-bg"
            onChange={(e) => onChange({ print_bg: e.target.value as FormField["print_bg"] })}
          >
            {catalogs.bgs.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Static text">
          <Input
            value={value.print_static_text || ""}
            placeholder="Fixed PDF text (when role is Static)"
            disabled={!writable}
            data-testid="input-new-print-static-text"
            onChange={(e) => onChange({ print_static_text: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4 pt-1 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(value.print_bold)}
            disabled={!writable}
            onChange={(e) => onChange({ print_bold: e.target.checked })}
          />
          Bold
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="check-print-label-bold"
            checked={Boolean(value.print_label_bold)}
            disabled={!writable}
            onChange={(e) => onChange({ print_label_bold: e.target.checked })}
          />
          Bold label
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="check-new-print-italic"
            checked={Boolean(value.print_italic)}
            disabled={!writable}
            onChange={(e) => onChange({ print_italic: e.target.checked })}
          />
          Italic
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="check-new-print-show-empty"
            checked={Boolean(value.print_show_empty)}
            disabled={!writable}
            onChange={(e) => onChange({ print_show_empty: e.target.checked })}
          />
          Show when empty
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="check-new-print-hline"
            checked={Boolean(value.print_hline)}
            disabled={!writable}
            onChange={(e) => onChange({ print_hline: e.target.checked })}
          />
          Line above
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="check-new-print-page-break"
            checked={Boolean(value.print_page_break)}
            disabled={!writable}
            onChange={(e) => onChange({ print_page_break: e.target.checked })}
          />
          Page break before
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="check-print-keep-together"
            checked={value.print_keep_together !== false}
            disabled={!writable}
            onChange={(e) => onChange({ print_keep_together: e.target.checked })}
          />
          Keep together
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            data-testid="check-print-include"
            checked={Boolean(value.print_include)}
            disabled={!writable}
            onChange={(e) => onChange({ print_include: e.target.checked })}
          />
          Also print in zone
        </label>
      </div>
    </div>
  );
}

function FormBuilderPage() {
  const { me } = useAuth();
  const writable = canManage(me);
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [draftFields, setDraftFields] = useState<FormField[] | null>(null);
  const [newField, setNewField] = useState<FormField>(emptyNew());
  const [openKey, setOpenKey] = useState<string | null>(null);

  const forms = useQuery({
    queryKey: ["hr-lifecycle-forms"],
    queryFn: () => api<FormsResponse>("/hr-lifecycle/forms"),
  });

  const catalogs = useMemo(() => {
    const d = forms.data;
    return {
      zones: optList(d?.print_zones, FALLBACK.print_zones),
      aligns: optList(d?.print_aligns, FALLBACK.print_aligns),
      widths: optList(d?.print_widths, FALLBACK.print_widths),
      labelPos: optList(d?.print_label_positions, FALLBACK.print_label_positions),
      formats: optList(d?.print_formats, FALLBACK.print_formats),
      sizes: optList(d?.print_sizes, FALLBACK.print_sizes),
      vspaces: optList(d?.print_vspaces, FALLBACK.print_vspaces),
      borders: optList(d?.print_borders, FALLBACK.print_borders),
      indents: optList(d?.print_indents, FALLBACK.print_indents),
      labelWidths: optList(d?.print_label_widths, FALLBACK.print_label_widths),
      roles: optList(d?.print_roles, FALLBACK.print_roles),
      colors: optList(d?.print_colors, FALLBACK.print_colors),
      lineHeights: optList(d?.print_line_heights, FALLBACK.print_line_heights),
      bgs: optList(d?.print_bgs, FALLBACK.print_bgs),
      emptyAs: optList(d?.print_empty_as, FALLBACK.print_empty_as),
      presets: d?.print_presets?.length ? d.print_presets : FALLBACK.print_presets,
    };
  }, [forms.data]);

  const seed = useMutation({
    mutationFn: () => api("/hr-lifecycle/forms/seed", { method: "POST" }),
    onSuccess: () => {
      toast.success("Seeded", "Default form schemas created.");
      void qc.invalidateQueries({ queryKey: ["hr-lifecycle-forms"] });
    },
    onError: (e) => toast.error("Seed failed", errorMessage(e)),
  });

  const selected = useMemo(
    () => (forms.data?.forms ?? []).find((f) => f.id === selectedId) ?? forms.data?.forms?.[0],
    [forms.data, selectedId]
  );

  const fields = draftFields ?? selected?.fields ?? [];

  const boundKeys = useMemo(() => {
    if (!selected) return new Set<string>();
    const fromForm = selected.template_bound_keys;
    const fromKind = forms.data?.template_bound_by_kind?.[selected.kind];
    return new Set(fromForm?.length ? fromForm : fromKind ?? []);
  }, [selected, forms.data?.template_bound_by_kind]);

  const save = useMutation({
    mutationFn: () =>
      api<FormDef>(`/hr-lifecycle/forms/${selected!.id}`, {
        method: "PUT",
        body: { fields },
      }),
    onSuccess: (saved) => {
      setDraftFields(null);
      qc.setQueryData<FormsResponse>(["hr-lifecycle-forms"], (old) => {
        if (!old?.forms) return old;
        return {
          ...old,
          forms: old.forms.map((f) =>
            f.id === saved.id
              ? {
                  ...f,
                  ...saved,
                  fields: saved.fields ?? f.fields,
                  version: saved.version ?? f.version,
                }
              : f
          ),
        };
      });
      void qc.invalidateQueries({ queryKey: ["hr-lifecycle-forms"] });
      toast.success(`Print layout saved · v${saved.version}`);
    },
    onError: (e) => toast.error("Save failed", errorMessage(e)),
  });

  const softDelete = useMutation({
    mutationFn: (key: string) =>
      api(`/hr-lifecycle/forms/${selected!.id}/fields/${key}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Field removed", "Soft-deleted — legacy PDFs keep their snapshot.");
      setDraftFields(null);
      setOpenKey(null);
      void qc.invalidateQueries({ queryKey: ["hr-lifecycle-forms"] });
    },
    onError: (e) => toast.error("Delete failed", errorMessage(e)),
  });

  const patchField = (idx: number, patch: Partial<FormField>) => {
    const next = [...fields];
    next[idx] = { ...fields[idx], ...patch };
    setDraftFields(next);
  };

  const resetPrintDefaults = (idx: number) => {
    const cur = fields[idx];
    if (!cur) return;
    patchField(idx, {
      ...printDefaults(),
      key: cur.key,
      label: cur.label,
      type: cur.type,
      required: cur.required,
    });
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    const tmp = next[idx];
    next[idx] = { ...next[j], sort_order: idx };
    next[j] = { ...tmp, sort_order: j };
    next.forEach((f, i) => {
      next[i] = { ...f, sort_order: i };
    });
    setDraftFields(next);
  };

  const addField = () => {
    if (!newField.key.trim() || !newField.label.trim()) {
      toast.warning("Missing", "Key and label are required.");
      return;
    }
    const key = newField.key.trim().toLowerCase().replace(/\s+/g, "_");
    if (fields.some((f) => f.key === key)) {
      toast.warning("Duplicate", "Field key already exists.");
      return;
    }
    const after = (newField.print_after || "").trim() || null;
    if (after && !fields.some((f) => f.key === after)) {
      toast.warning("Print after", "Choose an existing field, or leave blank.");
      return;
    }
    setDraftFields([
      ...fields,
      {
        ...newField,
        key,
        label: newField.label.trim(),
        active: true,
        sort_order: fields.length,
        options: newField.type === "dropdown" ? ["Option A", "Option B"] : [],
        print_after: after,
      },
    ]);
    setOpenKey(key);
    const zoneLabel =
      catalogs.zones.find((z) => z.key === newField.print_zone)?.label || newField.print_zone;
    toast.success(
      "Field added",
      `${zoneLabel} · ${newField.print_width} · ${newField.print_align}. Save schema to apply.`
    );
    setNewField(emptyNew());
  };

  return (
    <div className="space-y-6 animate-[fade-in_0.25s_ease-out]" data-testid="hr-form-builder-page">
      <PageHeader
        title="HR Form Schema Builder"
        subtitle="Design each field’s print layout yourself — zone, width, align, format, presets, and more"
        actions={
          writable ? (
            <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
              Seed defaults
            </Button>
          ) : null
        }
      />

      {forms.isPending ? (
        <TableSkeleton columns={4} label="Loading forms…" />
      ) : forms.isError ? (
        <ErrorState error={forms.error} onRetry={forms.refetch} />
      ) : !(forms.data?.forms?.length) ? (
        <EmptyState
          title="No form schemas"
          message="Seed the default schemas for warning, increment, certificates, and notices."
          action={
            writable ? (
              <Button variant="gradient" onClick={() => seed.mutate()}>
                Seed defaults
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Forms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-2">
              {(forms.data?.forms ?? []).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                    selected?.id === f.id
                      ? "bg-[var(--brand-50)] font-semibold"
                      : "hover:bg-[var(--color-secondary)]"
                  }`}
                  onClick={() => {
                    setSelectedId(f.id);
                    setDraftFields(null);
                    setOpenKey(null);
                  }}
                >
                  <span>{f.name}</span>
                  <Badge variant="outline">{f.fields.length}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>

          {selected ? (
            <div className="space-y-4">
              {draftFields && writable ? (
                <div
                  className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning,var(--color-border))] bg-[var(--brand-50)] px-4 py-2 shadow-sm"
                  data-testid="bar-unsaved-print-layout"
                >
                  <span className="text-sm font-semibold">Unsaved print layout changes</span>
                  <Button
                    variant="gradient"
                    size="sm"
                    disabled={save.isPending}
                    onClick={() => save.mutate()}
                  >
                    Save
                  </Button>
                </div>
              ) : null}
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <CardTitle>{selected.name}</CardTitle>
                      <CardDescription>
                        {selected.kind} · v{selected.version}
                        {draftFields ? " · unsaved changes" : ""}
                        {" · "}
                        expand a field to edit its print layout
                      </CardDescription>
                    </div>
                    {writable ? (
                      <Button
                        variant="gradient"
                        disabled={!draftFields || save.isPending}
                        onClick={() => save.mutate()}
                      >
                        Save schema
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {fields.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      No fields yet — add one below with print layout settings.
                    </p>
                  ) : null}
                  {fields.map((f, idx) => {
                    const open = openKey === f.key;
                    const isBound = boundKeys.has(f.key);
                    const role = f.print_role || "field";
                    return (
                      <div
                        key={f.key}
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white"
                        data-testid={`field-card-${f.key}`}
                      >
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => setOpenKey(open ? null : f.key)}
                            data-testid={`btn-toggle-print-${f.key}`}
                          >
                            <LayoutTemplate
                              size={16}
                              className="shrink-0 text-[var(--color-primary)]"
                            />
                            <span className="truncate font-semibold">{f.label}</span>
                            <span className="font-mono text-xs text-[var(--color-muted-foreground)]">
                              {f.key}
                            </span>
                            {isBound ? <Badge variant="secondary">Letter body</Badge> : null}
                            <Badge variant="outline">{f.print_zone || "particulars"}</Badge>
                            <Badge variant="secondary">{f.print_width || "full"}</Badge>
                            <Badge variant="secondary">{f.print_align || "left"}</Badge>
                            {role !== "field" ? (
                              <Badge variant="outline">{role}</Badge>
                            ) : null}
                            {open ? (
                              <ChevronUp size={16} className="ms-auto shrink-0" />
                            ) : (
                              <ChevronDown size={16} className="ms-auto shrink-0" />
                            )}
                          </button>
                          {writable ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Move ${f.key} up`}
                                disabled={idx === 0}
                                onClick={() => moveField(idx, -1)}
                              >
                                <ChevronUp size={14} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Move ${f.key} down`}
                                disabled={idx === fields.length - 1}
                                onClick={() => moveField(idx, 1)}
                              >
                                <ChevronDown size={14} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Soft-delete ${f.key}`}
                                onClick={() => softDelete.mutate(f.key)}
                              >
                                <Trash2 size={14} className="text-[var(--color-destructive)]" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {open ? (
                          <div className="border-t border-[var(--color-border)] bg-[var(--brand-50)]/40 p-3">
                            <div className="mb-3 grid items-end gap-2 sm:grid-cols-2">
                              <Field label="Label">
                                <Input
                                  value={f.label}
                                  disabled={!writable}
                                  onChange={(e) => patchField(idx, { label: e.target.value })}
                                />
                              </Field>
                              <Field label="Type">
                                <Select
                                  value={f.type}
                                  disabled={!writable}
                                  onChange={(e) => patchField(idx, { type: e.target.value })}
                                >
                                  {FIELD_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                            </div>
                            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--color-primary)]">
                              PRINT FORMAT / LAYOUT SETTINGS
                            </p>
                            <PrintControls
                              value={f}
                              writable={writable}
                              fields={fields}
                              catalogs={catalogs}
                              templateBound={isBound}
                              onChange={(patch) => patchField(idx, patch)}
                              onResetPrintDefaults={() => resetPrintDefaults(idx)}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {writable ? (
                <div
                  className="space-y-3 rounded-[var(--radius-md)] border-2 border-[var(--color-primary)] bg-[var(--brand-50)] p-4"
                  data-testid="panel-add-field-print-layout"
                >
                  <p className="text-sm font-bold uppercase tracking-wide text-[var(--color-primary)]">
                    PRINT FORMAT / LAYOUT SETTINGS — add field
                  </p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Choose a preset or set every option yourself, then add the field to this form
                    schema.
                  </p>
                  <PrintControls
                    value={newField}
                    showKey
                    writable
                    fields={fields}
                    catalogs={catalogs}
                    onChange={(patch) => setNewField((n) => ({ ...n, ...patch }))}
                    onResetPrintDefaults={() => setNewField((n) => ({ ...n, ...printDefaults() }))}
                  />
                  <Button variant="gradient" data-testid="btn-add-form-field" onClick={addField}>
                    <Plus size={15} /> Add field to schema
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default FormBuilderPage;
