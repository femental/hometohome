"use client";

import { useLocale, useTranslations } from "next-intl";
import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { guestErrorMessageKey } from "@/server/guest/errors";
import type { SubmitRequestResult } from "@/server/guest/requests";
import { quoteAction, submitRequestAction } from "../actions";
import { PricePreview, type PreviewState } from "./PricePreview";

type Stay = { moveIn: string; lastNight: string; occupants: 1 | 2 };

/** Inputs the server may report as invalid (`request.invalid.*`); `_form` is a form-level issue. */
type FieldName =
  | "_form"
  | "roomId"
  | "moveIn"
  | "lastNight"
  | "occupants"
  | "guestName"
  | "nationality"
  | "gender"
  | "contact"
  | "message"
  | "coOccupantName"
  | "coOccupantGender";

const LINK_BUTTON =
  "inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700";

const stayQuery = (s: Stay) =>
  new URLSearchParams({ moveIn: s.moveIn, lastNight: s.lastNight, occupants: String(s.occupants) }).toString();

/**
 * Stay picker + live price preview (quoteAction, server-priced) + the request form. Signed-out
 * guests get a "log in to request" link that returns here with the chosen stay.
 *
 * Submitted from onSubmit (not `<form action>`): React resets a form after an action-prop
 * submission, which would wipe the guest's input when the server returns an error.
 */
export function RequestForm({
  roomId,
  signedIn,
  defaultName,
  initialStay,
  initialPreview,
  minMoveIn,
  maxOccupants,
  genderPolicy,
}: {
  roomId: string;
  signedIn: boolean;
  defaultName: string;
  initialStay: Stay;
  initialPreview: PreviewState;
  minMoveIn: string;
  maxOccupants: number;
  genderPolicy: string;
}) {
  const t = useTranslations("request");
  const tRoot = useTranslations();
  const locale = useLocale();
  const [stay, setStay] = useState<Stay>(initialStay);
  const [preview, setPreview] = useState<PreviewState>(initialPreview);
  const latest = useRef(0);

  const [state, dispatch, pending] = useActionState(
    async (_prev: SubmitRequestResult | null, fd: FormData) => submitRequestAction(fd),
    null,
  );

  function changeStay(patch: Partial<Stay>) {
    const next = { ...stay, ...patch };
    setStay(next);
    // Keep the stay in the URL so a reload or the login round trip returns to it.
    window.history.replaceState(null, "", `?${stayQuery(next)}`);

    const seq = ++latest.current;
    if (!next.moveIn || !next.lastNight) {
      setPreview({ kind: "empty" });
      return;
    }
    setPreview({ kind: "loading" });
    quoteAction({ roomId, ...next })
      .then((r) => {
        if (seq === latest.current) setPreview(r.ok ? { kind: "quote", quote: r.quote } : { kind: "error", error: r.error });
      })
      .catch(() => {
        if (seq === latest.current) setPreview({ kind: "empty" });
      });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => dispatch(formData));
  }

  const invalid = new Set(state && state.error === "VALIDATION" ? (state.fields ?? []) : []);
  const fieldError = (name: FieldName) => (invalid.has(name) ? t(`invalid.${name}`) : undefined);
  const otherFieldErrors = [...invalid].filter((f): f is "_form" | "roomId" => f === "_form" || f === "roomId");

  const policy = genderPolicy === "male" || genderPolicy === "female" ? genderPolicy : null;
  const loginHref = `/login?next=${encodeURIComponent(`/${locale}/rooms/${roomId}?${stayQuery(stay)}`)}`;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="roomId" value={roomId} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold text-zinc-900">{t("stay")}</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("moveIn")}
            name="moveIn"
            type="date"
            min={minMoveIn}
            value={stay.moveIn}
            onChange={(e) => changeStay({ moveIn: e.currentTarget.value })}
            error={fieldError("moveIn")}
            required
          />
          <Field
            label={t("lastNight")}
            name="lastNight"
            type="date"
            min={stay.moveIn || minMoveIn}
            value={stay.lastNight}
            onChange={(e) => changeStay({ lastNight: e.currentTarget.value })}
            error={fieldError("lastNight")}
            required
          />
        </div>
        <Field
          as="select"
          label={t("occupants")}
          name="occupants"
          value={String(stay.occupants)}
          onChange={(e) => changeStay({ occupants: e.currentTarget.value === "2" ? 2 : 1 })}
          error={fieldError("occupants")}
        >
          <option value="1">{t("one")}</option>
          {maxOccupants >= 2 && <option value="2">{t("two")}</option>}
        </Field>
        <p className="text-xs text-zinc-500">{t("stayHint")}</p>
        {policy && <p className="text-xs text-zinc-700">{t("genderOnly", { policy: t(policy) })}</p>}
      </fieldset>

      <PricePreview state={preview} moveIn={stay.moveIn} />

      {!signedIn ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-600">{t("loginHint")}</p>
          <Link href={loginHref} className={LINK_BUTTON}>
            {t("loginToRequest")}
          </Link>
        </div>
      ) : (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold text-zinc-900">{t("aboutYou")}</legend>
            <Field label={t("guestName")} name="guestName" defaultValue={defaultName} maxLength={100} autoComplete="name" error={fieldError("guestName")} required />
            <Field
              label={t("nationality")}
              name="nationality"
              placeholder={t("nationalityPlaceholder")}
              maxLength={56}
              autoComplete="country-name"
              error={fieldError("nationality")}
              required
            />
            <Field as="select" label={t("gender")} name="gender" defaultValue={policy ?? ""} error={fieldError("gender")} required>
              <option value="" disabled>
                {t("choose")}
              </option>
              <option value="female">{t("female")}</option>
              <option value="male">{t("male")}</option>
            </Field>
            <Field label={t("contact")} name="contact" placeholder={t("contactPlaceholder")} maxLength={100} error={fieldError("contact")} required />
          </fieldset>

          {stay.occupants === 2 && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-sm font-semibold text-zinc-900">{t("secondGuest")}</legend>
              <Field label={t("coOccupantName")} name="coOccupantName" maxLength={100} error={fieldError("coOccupantName")} required />
              <Field
                as="select"
                label={t("coOccupantGender")}
                name="coOccupantGender"
                defaultValue={policy ?? ""}
                error={fieldError("coOccupantGender")}
                required
              >
                <option value="" disabled>
                  {t("choose")}
                </option>
                <option value="female">{t("female")}</option>
                <option value="male">{t("male")}</option>
              </Field>
            </fieldset>
          )}

          <Field
            as="textarea"
            label={t("message")}
            name="message"
            rows={4}
            maxLength={1000}
            placeholder={t("messagePlaceholder")}
            error={fieldError("message")}
          />

          {state && (
            <div role="alert" className="flex flex-col gap-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <p>{tRoot(guestErrorMessageKey(state.error))}</p>
              {otherFieldErrors.map((f) => (
                <p key={f}>{t(`invalid.${f}`)}</p>
              ))}
            </div>
          )}

          <Button type="submit" pending={pending} disabled={preview.kind !== "quote"} className="w-full">
            {t("submit")}
          </Button>
        </>
      )}
    </form>
  );
}
