/**
 * Create (or confirm) an Arend Studio admin, as the database OWNER.
 *   npx tsx scripts/create-admin.ts --phone 0720942426 --name "Your Name"
 * On the server: docker compose -f docker-compose.prod.yml run --rm migrate \
 *   npx tsx scripts/create-admin.ts --phone ... --name "..."
 * Admins can create schools but cannot see any school's data unless the school turns on
 * support access.
 */
import "dotenv/config";
import { createClient } from "../src/lib/db-core";
import { normalizePhone } from "../src/lib/phone";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const phone = normalizePhone(arg("phone") ?? "");
  const name = (arg("name") ?? "").trim();
  if (!phone || !name) {
    console.error('Usage: create-admin.ts --phone 07XXXXXXXX --name "Full Name"');
    process.exit(2);
  }
  const owner = createClient(process.env.DATABASE_URL);
  try {
    const user = await owner.user.upsert({
      where: { phone },
      create: { phone, name, isPlatformAdmin: true },
      update: { isPlatformAdmin: true },
    });
    await owner.auditLog.create({
      data: {
        actorId: user.id,
        action: "platform.admin.create",
        targetType: "user",
        targetId: user.id,
        after: { phone },
      },
    });
    console.log(
      `Arend admin ready: ${name} (${phone}). Sign in at the app address with this phone.`,
    );
  } finally {
    await owner.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
