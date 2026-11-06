/**
 * The main screens of Kiota, for the responsive checks (e2e/responsive.spec.ts) and the
 * before/after screenshots (scripts/screenshots.ts). Paths may use ids looked up from the seed.
 */
export const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

/** Extra widths checked for sideways scrolling only (no screenshots). */
export const OVERFLOW_ONLY = { name: "small-phone", width: 320, height: 640 } as const;

export type Role =
  "anon" | "director" | "bursar" | "teacher" | "guard" | "boarding" | "admin" | "picker" | "parent";

export const PHONES: Record<Exclude<Role, "anon">, string> = {
  director: "+254711000001",
  bursar: "+254711000002",
  teacher: "+254711000003",
  guard: "+254711000004",
  boarding: "+254711000005",
  admin: "+254700000001",
  picker: "+254733000001",
  parent: "+254744000001",
};

export type Ids = { studentId: string; receiptId: string; brianLink: string; leaveoutId: string };

export type Screen = {
  name: string;
  role: Role;
  /** "site" = the public website address; default the app. */
  host?: "site" | "app";
  path: (ids: Ids) => string;
};

export const SCREENS: Screen[] = [
  { name: "site-home", role: "anon", host: "site", path: () => "/" },
  { name: "sign-in", role: "anon", path: () => "/sign-in" },
  { name: "school-picker", role: "picker", path: () => "/schools" },
  { name: "dashboard-director", role: "director", path: () => "/dashboard" },
  { name: "dashboard-bursar", role: "bursar", path: () => "/dashboard" },
  { name: "dashboard-teacher", role: "teacher", path: () => "/dashboard" },
  { name: "gate", role: "guard", path: () => "/gate" },
  { name: "staff", role: "director", path: () => "/dashboard/staff" },
  { name: "setup", role: "director", path: () => "/dashboard/setup" },
  { name: "students", role: "director", path: () => "/dashboard/students" },
  { name: "student-profile", role: "director", path: (i) => `/dashboard/students/${i.studentId}` },
  { name: "import", role: "director", path: () => "/dashboard/students/import" },
  { name: "fees", role: "bursar", path: () => "/dashboard/fees" },
  { name: "fees-setup", role: "bursar", path: () => "/dashboard/fees/setup" },
  { name: "record-payment", role: "bursar", path: () => "/dashboard/fees/pay" },
  { name: "payments", role: "bursar", path: () => "/dashboard/fees/payments" },
  { name: "receipt", role: "bursar", path: (i) => `/dashboard/fees/receipts/${i.receiptId}` },
  { name: "mpesa", role: "bursar", path: () => "/dashboard/fees/mpesa" },
  { name: "fee-reports", role: "bursar", path: () => "/dashboard/fees/reports" },
  { name: "messages", role: "director", path: () => "/dashboard/messages" },
  { name: "notice-new", role: "director", path: () => "/dashboard/messages/new" },
  { name: "message-log", role: "director", path: () => "/dashboard/messages/log" },
  { name: "wallet", role: "director", path: () => "/dashboard/messages/wallet" },
  { name: "leaveouts", role: "boarding", path: () => "/dashboard/leaveouts" },
  { name: "leaveout", role: "boarding", path: (i) => `/dashboard/leaveouts/${i.leaveoutId}` },
  { name: "leaveout-reports", role: "boarding", path: () => "/dashboard/leaveouts/reports" },
  { name: "admin", role: "admin", path: () => "/admin" },
  { name: "admin-messaging", role: "admin", path: () => "/admin/messaging" },
  { name: "parent-home", role: "parent", path: () => "/parent" },
  { name: "parent-child", role: "parent", path: (i) => `/parent/${i.brianLink}` },
  { name: "parent-fees", role: "parent", path: (i) => `/parent/${i.brianLink}/fees` },
  { name: "parent-notices", role: "parent", path: (i) => `/parent/${i.brianLink}/notices` },
  { name: "parent-leaveouts", role: "parent", path: (i) => `/parent/${i.brianLink}/leaveouts` },
  { name: "account", role: "parent", path: () => "/account" },
];
