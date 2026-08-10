"use client";

import Image from "next/image";
import EnrollmentForm from "@/components/EnrollmentForm";
import { useSettings } from "@/components/SettingsProvider";
import lombardlogo from "@/public/lombardlogo.avif";

// The lobby version of the enrollment form. Same questions as the public
// /enroll page — this one just wears the business's branding, because it
// runs on the kiosk rather than inside a page that already has a header.
export default function SignupPage() {
  const { settings } = useSettings();
  const logo = settings.business.logoData;

  return (
    <div>
      <div className="flex flex-col items-center pt-10">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={settings.business.name} className="h-20 w-auto object-contain" />
        ) : (
          <Image src={lombardlogo} alt={settings.business.name} width={100} height={100} className="object-cover" />
        )}
      </div>
      <EnrollmentForm source="kiosk" />
    </div>
  );
}
