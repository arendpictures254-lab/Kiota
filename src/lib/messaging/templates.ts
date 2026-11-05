/**
 * Message templates: rendering, and which template text to use. Pure.
 *
 * Template text lives in the database (message_templates), never in code:
 *  - {name} is replaced by a value;
 *  - [[ ... ]] is an optional part, left out when any {name} inside it has no value.
 * Example: "Balance {balance}[[ due by {due_date}]]." -> "Balance KES 500." when there is no date.
 */

export type TemplateVars = Record<string, string | null | undefined>;

export type TemplateRow = {
  key: string;
  language: "en" | "sw";
  category: string;
  critical: boolean;
  smsBody: string;
  whatsappName: string | null;
  whatsappBody: string | null;
  whatsappParams: string[];
  whatsappHeader: string | null;
  whatsappStatus: string;
};

const present = (v: string | null | undefined) => v !== null && v !== undefined && v.trim() !== "";

export function renderTemplate(body: string, vars: TemplateVars): string {
  const withSections = body.replace(/\[\[([\s\S]*?)\]\]/g, (_, inner: string) => {
    const names = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    return names.every((n) => present(vars[n])) ? inner : "";
  });
  return withSections
    .replace(/\{(\w+)\}/g, (_, n: string) => (present(vars[n]) ? vars[n]!.trim() : ""))
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,])/g, "$1")
    .trim();
}

/** WhatsApp body parameters {{1}}, {{2}}... in the template's order (WhatsApp refuses blanks). */
export function whatsappParams(t: Pick<TemplateRow, "whatsappParams">, vars: TemplateVars) {
  return t.whatsappParams.map((n) => (present(vars[n]) ? vars[n]!.trim() : "-"));
}

/** The template in the guardian's language, or English when there is no translation. */
export function pickTemplate<T extends Pick<TemplateRow, "key" | "language">>(
  templates: readonly T[],
  key: string,
  language: "en" | "sw",
): T | null {
  return (
    templates.find((t) => t.key === key && t.language === language) ??
    templates.find((t) => t.key === key && t.language === "en") ??
    null
  );
}

export function whatsappReady(t: Pick<TemplateRow, "whatsappName" | "whatsappStatus">) {
  return !!t.whatsappName && t.whatsappStatus === "approved";
}

/** The WhatsApp text as the parent sees it ({{1}}, {{2}}... filled in), for the message log. */
export function renderWhatsAppBody(body: string, params: readonly string[]) {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}
