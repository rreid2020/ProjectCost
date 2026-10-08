import { SignUp } from "@clerk/nextjs";
import { AuthShell, authAppearance } from "@/components/AuthShell";

export default function Page() {
  return (
    <AuthShell title="Start your free trial" subtitle="Create your account, then set up your company. New companies start empty; you become its first admin.">
      <SignUp appearance={authAppearance} />
    </AuthShell>
  );
}
