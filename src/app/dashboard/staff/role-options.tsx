import { Checkbox } from "@/components/ui";
import { BUILT_IN_ROLES } from "@/lib/auth/catalog";

/** Role checkboxes. Built-in roles for now; custom roles come later. */
export function RoleOptions({
  selected = [],
  hideLegend = false,
}: {
  selected?: (string | null)[];
  hideLegend?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={hideLegend ? "sr-only" : "mb-1.5 text-sm font-semibold text-ink"}>
        Roles
      </legend>
      {BUILT_IN_ROLES.filter((r) => !r.hidden).map((role) => (
        <Checkbox
          key={role.key}
          name="roles"
          value={role.key}
          label={role.name}
          description={role.description}
          defaultChecked={selected.includes(role.key)}
        />
      ))}
    </fieldset>
  );
}
