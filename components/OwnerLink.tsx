"use client";

import Link from "next/link";
import { ownerHref } from "@/lib/dogs";

/**
 * A household, rendered as a link into its profile.
 *
 * The counterpart to DogLink, and deliberately much simpler: no hover card,
 * because everything worth knowing about a household is the balance, and that
 * needs a query this component has no business making from inside a table
 * cell.
 *
 * The phone is the identity — it is what every lookup in the app keys on and
 * what a payment carries — but it is not what staff recognise. So the name
 * leads when there is one, with the number kept alongside for the cases where
 * two families share a surname.
 */
export default function OwnerLink({
  phone,
  name,
  showPhone = false,
  className = "",
}: {
  phone: string;
  /** Absent on rows that carry only a number, such as a payment. */
  name?: string | null;
  /** Shows the number after the name, for lists where it disambiguates. */
  showPhone?: boolean;
  className?: string;
}) {
  const label = (name ?? "").trim();
  if (!phone) return <span className={className}>{label || "Unknown"}</span>;

  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <Link
        href={ownerHref(phone)}
        className="underline decoration-dotted underline-offset-2 hover:text-accent-600"
      >
        {label || phone}
      </Link>
      {/* Only when it adds something. Repeating the number beside a row that
          already shows it is noise, and on a name-less row it IS the label. */}
      {showPhone && label && <span className="text-[11px] text-ink-3">{phone}</span>}
    </span>
  );
}
