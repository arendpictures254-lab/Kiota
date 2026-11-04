/**
 * Permission catalogue and built-in roles.
 *
 * Permissions are the unit of access. Roles are named bundles of permissions. Built-in
 * roles below are synced into the database (school_id NULL); schools may later create
 * custom roles from the same permissions. Code checks permissions, never role names.
 */

export const PERMISSIONS = {
  "school.view": "Open the school dashboard",
  "school.settings.manage": "Change school settings, including Arend Studio support access",
  "staff.view": "See the staff list",
  "staff.manage": "Invite staff, assign roles and remove staff",
  "leaveout.grant": "Grant or withdraw permission to approve leave-outs",
  "leaveout.approve": "Approve leave-outs",
  "leaveout.request": "Request leave-outs for students",
  "audit.view": "Read the audit log",
  "fees.view": "See fee balances, invoices and receipts",
  "fees.manage": "Set up fee items and fee structures",
  "payments.record": "Record payments and issue receipts",
  "payments.reverse": "Reverse payments and receipts",
  "academics.view": "See marks, report cards and analytics",
  "marks.enter": "Enter marks for assigned classes and subjects",
  "marks.signoff": "Sign off marks for a class",
  "marks.unlock": "Change marks after sign-off",
  "attendance.mark": "Mark class attendance",
  "notices.send": "Send notices to parents",
  "boarding.manage": "Manage dormitories and roll calls",
  "sickbay.view": "See sick bay and medical records",
  "pocketmoney.manage": "Record pocket money spending",
  "stores.manage": "Record stock in and out",
  "gate.scan": "Mark students out and back in at the gate",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

/**
 * Permissions only a Director may hand out, person by person (never via custom roles).
 * Granting them requires "leaveout.grant".
 */
export const DIRECTOR_GRANT_ONLY: readonly PermissionKey[] = ["leaveout.approve"];

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export type BuiltInRole = {
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
};

export const BUILT_IN_ROLES: readonly BuiltInRole[] = [
  {
    key: "director",
    name: "Director",
    description: "Everything in the school. Assigns roles and leave-out approvers.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "principal",
    name: "Principal",
    description: "Academics, discipline, attendance and notices. No editing of money records.",
    permissions: [
      "school.view",
      "staff.view",
      "audit.view",
      "fees.view",
      "academics.view",
      "marks.signoff",
      "marks.unlock",
      "attendance.mark",
      "notices.send",
      "leaveout.request",
    ],
  },
  {
    key: "bursar",
    name: "Bursar",
    description: "Fee structures, payments, receipts, reversals and statements.",
    permissions: ["school.view", "fees.view", "fees.manage", "payments.record", "payments.reverse"],
  },
  {
    key: "accounts_clerk",
    name: "Accounts clerk",
    description: "Records payments and issues receipts.",
    permissions: ["school.view", "fees.view", "payments.record"],
  },
  {
    key: "class_teacher",
    name: "Class teacher",
    description: "Their class: attendance, marks, comments, sign-off and leave-out requests.",
    permissions: [
      "school.view",
      "academics.view",
      "marks.enter",
      "marks.signoff",
      "attendance.mark",
      "leaveout.request",
    ],
  },
  {
    key: "subject_teacher",
    name: "Subject teacher",
    description: "Mark entry and analysis for their subjects and classes.",
    permissions: ["school.view", "academics.view", "marks.enter"],
  },
  {
    key: "boarding_master",
    name: "Boarding master",
    description: "Dormitories, roll calls, leave-out requests, sick bay and pocket money.",
    permissions: [
      "school.view",
      "boarding.manage",
      "leaveout.request",
      "sickbay.view",
      "pocketmoney.manage",
    ],
  },
  {
    key: "storekeeper",
    name: "Storekeeper",
    description: "Stock in, stock out, uniform issue and food store usage.",
    permissions: ["school.view", "stores.manage"],
  },
  {
    key: "gate_guard",
    name: "Gate guard",
    description: "Marks students out and back in at the gate.",
    permissions: ["school.view", "gate.scan"],
  },
];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
