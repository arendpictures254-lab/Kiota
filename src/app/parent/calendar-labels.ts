import type { CalendarLabels } from "@/components/attendance-calendar";
import type { T } from "@/lib/i18n";

/** The attendance calendar's words in the parent's language. */
export function calendarLabels(t: T): CalendarLabels {
  return {
    present: t("att.present"),
    late: t("att.late"),
    absent: t("att.absent"),
    part: t("att.part"),
    on_leave: t("att.onLeave"),
    none: t("att.noRegister"),
    weekdays: t("att.weekdays").split(","),
  };
}
