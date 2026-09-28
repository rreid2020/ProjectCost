import "server-only";
import { headers } from "next/headers";

/** Public origin of the app, for redirect URLs sent to Stripe and Intuit. APP_URL wins when set. */
export async function appOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}
