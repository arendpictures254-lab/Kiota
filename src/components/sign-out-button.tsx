import { signOutAction } from "@/app/session-actions";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="h-10 rounded-lg px-3 text-sm font-semibold text-teal hover:bg-egg-blue/30"
      >
        Sign out
      </button>
    </form>
  );
}
