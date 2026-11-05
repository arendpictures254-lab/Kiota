/**
 * Try Kiota on a real phone over the local Wi-Fi: `npm run dev:phone`.
 *
 * A phone cannot open app.localhost, so this runs the dev server with the app on this
 * computer's Wi-Fi address (http://192.168.x.x:3000) and the public site on site.localhost.
 * Sign-in codes still print in this terminal and in .dev/sms-outbox.log.
 *
 * Not on plain http: installing to the home screen (that needs https, so try it on staging).
 */
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.PORT ?? 3000);

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (
        a.family === "IPv4" &&
        !a.internal &&
        /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)
      )
        return a.address;
    }
  }
  return null;
}

const ip = process.argv[2] ?? lanAddress();
if (!ip) {
  console.error("No Wi-Fi address found. Pass it: npm run dev:phone -- 192.168.1.20");
  process.exit(1);
}

const appUrl = `http://${ip}:${PORT}`;
console.log(`\nOn your phone (same Wi-Fi), open:  ${appUrl}\n`);
console.log(
  "If it does not load, allow Node.js through the Windows firewall for private networks.\n",
);

const child = spawn("npx", ["next", "dev", "-H", "0.0.0.0", "-p", String(PORT)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    APP_URL: appUrl,
    // Not plain localhost: Next.js prefetches redirect targets from localhost:<port>, which must
    // not look like the public site (it would bounce app paths over to the app address).
    SITE_URL: `http://site.localhost:${PORT}`,
    KIOTA_DEV_ORIGINS: ip,
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
