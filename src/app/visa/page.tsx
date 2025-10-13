import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Your immigration status (eVisa)",
  description:
    "View an example eVisa status summary and access the official immigration status service.",
};

export default function VisaPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center gap-8 px-4 py-16 text-center">
      <div className="w-full max-w-4xl space-y-8">
        <Image
          src="/visa-photo.png"
          alt="Your immigration status (eVisa)"
          width={960}
          height={540}
          className="h-auto w-full rounded-xl border border-border bg-white shadow-sm"
          priority
          quality={85}
        />
        <Image
          src="/visa-photo-2.png"
          alt="Your immigration status (eVisa)"
          width={960}
          height={540}
          className="h-auto w-full rounded-xl border border-border bg-white shadow-sm"
          loading="lazy"
          quality={85}
        />
      </div>
      <div className="flex flex-col items-center gap-2">
        <Link
          href="https://view-immigration-status.service.gov.uk/status"
          target="_blank"
          rel="noopener noreferrer"
          className="text-lg font-semibold text-blue-600 underline-offset-4 hover:underline"
        >
          Check your immigration status (GOV.UK)
        </Link>
      </div>
    </main>
  );
}
