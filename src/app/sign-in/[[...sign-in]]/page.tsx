import { SignIn } from "@clerk/nextjs";
import { AuthShell, authAppearance } from "@/components/AuthShell";

export default function Page() {
  return (
    <AuthShell title="Sign in" subtitle="Use your work account to open your company's projects.">
      <SignIn appearance={authAppearance} />
    </AuthShell>
  );
}
