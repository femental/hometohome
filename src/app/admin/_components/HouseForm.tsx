"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { AMENITIES, AMENITY_LABELS, DISTRICTS } from "@/domain/amenities";
import { AddressSearch, type AddressSelection } from "./AddressSearch";
import { FormMessage, I18nField, useActionForm, useFieldIds, type FormAction } from "./form-utils";

type I18n = { en: string; ko?: string };
type Station = { name_en: string; name_ko: string; line: string; walk_min: number };

export type HouseFormValues = {
  name: I18n;
  description: I18n;
  houseRules: I18n;
  addressKo: string;
  addressEn: string;
  district: string;
  lat: number | null;
  lng: number | null;
  nearestStations: Station[];
  amenities: string[];
};

const MAX_STATIONS = 5;

export function HouseForm({
  action,
  initial,
  submitLabel,
}: {
  action: FormAction;
  initial?: HouseFormValues;
  submitLabel: string;
}) {
  const { state, pending, onSubmit, fieldError } = useActionForm(action);
  const fieldId = useFieldIds();

  // Address fields are controlled so the address search can fill them in.
  const [addressKo, setAddressKo] = useState(initial?.addressKo ?? "");
  const [district, setDistrict] = useState(initial?.district ?? "");
  const [lat, setLat] = useState(initial?.lat?.toString() ?? "");
  const [lng, setLng] = useState(initial?.lng?.toString() ?? "");
  // Row keys are deterministic (server and client render the same ids).
  const [stations, setStations] = useState(() =>
    (initial?.nearestStations ?? []).map((s, i) => ({ key: `s${i}`, initial: s as Partial<Station> })),
  );
  const [addressEdited, setAddressEdited] = useState(false);
  const [nextRow, setNextRow] = useState(stations.length);

  function onAddress(sel: AddressSelection) {
    setAddressEdited(false);
    setAddressKo(sel.addressKo);
    if (sel.district) setDistrict(sel.district);
    if (sel.lat !== undefined && sel.lng !== undefined) {
      setLat(String(sel.lat));
      setLng(String(sel.lng));
    }
  }

  const stationErrors =
    state && !state.ok && state.fieldErrors
      ? Object.entries(state.fieldErrors).filter(([k]) => k.startsWith("nearestStations"))
      : [];
  const amenityError = state && !state.ok ? Object.entries(state.fieldErrors ?? {}).find(([k]) => k.startsWith("amenities"))?.[1] : undefined;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-zinc-900">기본 정보</h3>
        <I18nField label="숙소 이름" name="name" value={initial?.name} error={fieldError} fieldId={fieldId} />
        <I18nField label="설명" name="description" value={initial?.description} error={fieldError} fieldId={fieldId} multiline />
        <I18nField label="하우스 규칙" name="houseRules" value={initial?.houseRules} error={fieldError} fieldId={fieldId} multiline />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-zinc-900">주소</h3>
        <AddressSearch onSelect={onAddress} />
        <Field
          label="주소 (한글)"
          id={fieldId("addressKo")}
          name="addressKo"
          value={addressKo}
          onChange={(e) => {
            setAddressKo(e.target.value);
            // The coordinates belong to the searched address; drop them once the text is changed by hand.
            if (lat !== "" || lng !== "") {
              setLat("");
              setLng("");
              setAddressEdited(true);
            }
          }}
          error={fieldError("addressKo")}
        />
        {addressEdited && (
          <p role="status" className="text-xs text-amber-700">
            주소를 바꿨습니다. 주소 검색을 다시 하거나 위도·경도를 입력해 주세요.
          </p>
        )}
        <Field
          label="주소 (영문, 선택)"
          id={fieldId("addressEn")}
          name="addressEn"
          defaultValue={initial?.addressEn ?? ""}
          error={fieldError("addressEn")}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            as="select"
            label="지역(구)"
            id={fieldId("district")}
            name="district"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            error={fieldError("district")}
          >
            <option value="">선택</option>
            {DISTRICTS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.ko}
              </option>
            ))}
          </Field>
          <Field
            label="위도"
            id={fieldId("lat")}
            name="lat"
            inputMode="decimal"
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
              setAddressEdited(false);
            }}
            error={fieldError("lat")}
          />
          <Field
            label="경도"
            id={fieldId("lng")}
            name="lng"
            inputMode="decimal"
            value={lng}
            onChange={(e) => {
              setLng(e.target.value);
              setAddressEdited(false);
            }}
            error={fieldError("lng")}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-zinc-900">가까운 지하철역 (최대 {MAX_STATIONS}개)</h3>
        {stations.length === 0 && <p className="text-sm text-zinc-500">등록된 역이 없습니다.</p>}
        {stations.map((s, i) => (
          <div key={s.key} className="grid grid-cols-2 items-end gap-2 rounded-md border border-zinc-200 p-3 sm:grid-cols-[1fr_1fr_1fr_6rem_auto]">
            <Field label="역 이름 (영문)" name={`stations[${i}].name_en`} id={fieldId(`station-${s.key}-en`)} defaultValue={s.initial.name_en ?? ""} />
            <Field label="역 이름 (한글)" name={`stations[${i}].name_ko`} id={fieldId(`station-${s.key}-ko`)} defaultValue={s.initial.name_ko ?? ""} />
            <Field label="노선" name={`stations[${i}].line`} id={fieldId(`station-${s.key}-line`)} placeholder="2호선" defaultValue={s.initial.line ?? ""} />
            <Field
              label="도보(분)"
              name={`stations[${i}].walk_min`}
              id={fieldId(`station-${s.key}-walk`)}
              inputMode="numeric"
              defaultValue={s.initial.walk_min?.toString() ?? ""}
            />
            <Button variant="secondary" onClick={() => setStations((list) => list.filter((x) => x.key !== s.key))}>
              삭제
            </Button>
          </div>
        ))}
        {stationErrors.length > 0 && (
          <ul role="alert" className="text-xs text-red-600">
            {stationErrors.map(([k, msg]) => (
              <li key={k}>
                {Number(k.split(".")[1]) + 1}번째 역: {msg}
              </li>
            ))}
          </ul>
        )}
        {stations.length < MAX_STATIONS && (
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setStations((list) => [...list, { key: `s${nextRow}`, initial: {} }]);
              setNextRow((n) => n + 1);
            }}
          >
            역 추가
          </Button>
        )}
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-zinc-900">공용 시설</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AMENITIES.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" name="amenities" value={a} defaultChecked={initial?.amenities.includes(a)} />
              {AMENITY_LABELS[a].ko}
            </label>
          ))}
        </div>
        {amenityError && <p className="text-xs text-red-600">{amenityError}</p>}
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" pending={pending}>
          {submitLabel}
        </Button>
        <div className="flex-1">
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}
