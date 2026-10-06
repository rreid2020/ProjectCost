import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// The marketing page lives on the main website (see src/marketing and `npm run build:landing`).
// The app's root sends signed-in users to their dashboard, and visitors to MARKETING_URL (if set) or sign-in.
export default async function Home() {
  const { userId } = await auth({ treatPendingAsSignedOut: false });
  redirect(userId ? "/dashboard" : process.env.MARKETING_URL || "/sign-in");
}
