import type { Metadata } from "next";
import { PreferencesShell } from "../../../features/preferences/components/PreferencesShell";

export const metadata: Metadata = {
  title: "Preferences | ATLAS Airfare HCM",
  description: "Modern ATLAS HCM preferences, appearance, workspace, notifications, keyboard, safety, and admin settings."
};

export default function PreferencesPage() {
  return <PreferencesShell />;
}
