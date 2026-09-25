import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk's middleware only attaches the session to each request. Access control lives with the data:
// every app page and server action goes through getTenant()/requireWrite()/requireAdmin() (src/lib/tenant.ts),
// which redirects signed-out users to /sign-in, and the webhooks verify their signatures.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
