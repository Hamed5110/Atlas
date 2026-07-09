import { notFound } from "next/navigation";
import V2Shell from "../../v2-shell";

const allowedThemes = [
  "light-professional",
  "dark-professional",
  "high-contrast",
  "emerald-command",
  "slate-executive"
] as const;

type ThemeId = (typeof allowedThemes)[number];

export function generateStaticParams() {
  return allowedThemes.map((theme) => ({ theme }));
}

export default async function V2ThemePreviewPage({
  params
}: {
  params: Promise<{ theme: string }>;
}) {
  const resolved = await params;
  if (!allowedThemes.includes(resolved.theme as ThemeId)) {
    notFound();
  }

  return <V2Shell initialTheme={resolved.theme as ThemeId} />;
}
