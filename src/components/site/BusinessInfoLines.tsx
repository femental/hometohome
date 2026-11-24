import { useTranslations } from "next-intl";
import type { BusinessInfo } from "@/server/env";

const FIELDS = [
  ["BUSINESS_NAME", "name"],
  ["BUSINESS_REP", "rep"],
  ["BUSINESS_REG_NO", "regNo"],
  ["MAIL_ORDER_NO", "mailOrderNo"],
  ["BUSINESS_ADDRESS", "address"],
  ["BUSINESS_PHONE", "phone"],
  ["BUSINESS_EMAIL", "email"],
] as const;

/** Business registration lines (사업자 정보); a line is rendered only when its env key is set. */
export function BusinessInfoLines({ info }: { info: BusinessInfo }) {
  const t = useTranslations("footer.business");
  const lines = FIELDS.flatMap(([envKey, labelKey]) => {
    const value = info[envKey];
    return value ? [{ labelKey, value }] : [];
  });
  if (lines.length === 0) return null;

  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
      {lines.map(({ labelKey, value }) => (
        <div key={labelKey} className="flex gap-1">
          <dt className="font-medium">{t(labelKey)}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
