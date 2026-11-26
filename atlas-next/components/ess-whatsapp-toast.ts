import { toast } from "@/components/ui/toast";
import { describeEssWhatsApp, type EssWhatsAppResult } from "@/lib/ess-process";

export function toastEssWhatsApp(wa: EssWhatsAppResult | null | undefined, title = "WhatsApp") {
  const outcome = describeEssWhatsApp(wa);
  if (outcome) toast[outcome.tone](title, outcome.text);
}
