import Link from "next/link";
export default function NotFound() {
  return <div className="p-10 text-center text-sm text-slate-600">Not found. <Link href="/dashboard" className="text-brand-600 underline">Back to dashboard</Link></div>;
}
