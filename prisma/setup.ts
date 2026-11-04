/**
 * Setup helpers that run as the database OWNER (seed, test setup). Never used by the app.
 */
import { type PrismaClient } from "../src/generated/prisma/client";
import { BUILT_IN_ROLES, DIRECTOR_GRANT_ONLY, PERMISSIONS } from "../src/lib/auth/catalog";

/** Upsert the permission catalogue and built-in roles from src/lib/auth/catalog.ts. */
export async function syncCatalog(owner: PrismaClient) {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    const directorGrantOnly = (DIRECTOR_GRANT_ONLY as readonly string[]).includes(key);
    await owner.permission.upsert({
      where: { key },
      create: { key, description, directorGrantOnly },
      update: { description, directorGrantOnly },
    });
  }

  for (const role of BUILT_IN_ROLES) {
    const saved = await owner.role.upsert({
      where: { key: role.key },
      create: { key: role.key, name: role.name, description: role.description },
      update: { name: role.name, description: role.description },
    });
    await owner.rolePermission.deleteMany({ where: { roleId: saved.id } });
    await owner.rolePermission.createMany({
      data: role.permissions.map((permissionKey) => ({ roleId: saved.id, permissionKey })),
    });
  }
}

/**
 * Development only: let `kiota_app` log in with the password in APP_DATABASE_URL.
 * In production the role's password is set by whoever manages the database.
 */
export async function enableAppRoleLogin(owner: PrismaClient, appDatabaseUrl: string) {
  const url = new URL(appDatabaseUrl);
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (user !== "kiota_app") throw new Error(`APP_DATABASE_URL must use kiota_app, got ${user}`);
  // Identifiers and passwords cannot be bound parameters in ALTER ROLE.
  const quoted = `'${password.replace(/'/g, "''")}'`;
  await owner.$executeRawUnsafe(`ALTER ROLE kiota_app LOGIN PASSWORD ${quoted}`);
  const db = new URL(appDatabaseUrl).pathname.slice(1);
  await owner.$executeRawUnsafe(
    `GRANT CONNECT ON DATABASE "${db.replace(/"/g, '""')}" TO kiota_app`,
  );
}
