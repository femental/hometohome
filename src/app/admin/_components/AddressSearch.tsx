"use client";

import Script from "next/script";
import { useState, useTransition } from "react";
import { districtCodeFromSigungu } from "@/domain/amenities";
import { geocodeAction } from "../actions/geocode";

export type AddressSelection = { addressKo: string; district: string; lat?: number; lng?: number };

type PostcodeData = { roadAddress: string; address: string; sigungu: string; sigunguEnglish: string };

type DaumWindow = Window & {
  daum?: { Postcode: new (opts: { oncomplete: (data: PostcodeData) => void }) => { open: () => void } };
};

const POSTCODE_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

export function AddressSearch({ onSelect }: { onSelect: (r: AddressSelection) => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [noCoords, setNoCoords] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleComplete(data: PostcodeData) {
    const addressKo = data.roadAddress || data.address;
    const district = districtCodeFromSigungu(data.sigunguEnglish) ?? districtCodeFromSigungu(data.sigungu) ?? "";
    setNoCoords(false);
    startTransition(async () => {
      let coords: { lat: number; lng: number } | null = null;
      try {
        coords = await geocodeAction(addressKo);
      } catch {
        coords = null;
      }
      setNoCoords(!coords);
      onSelect(coords ? { addressKo, district, ...coords } : { addressKo, district });
    });
  }

  function open() {
    const daum = (window as DaumWindow).daum;
    if (!daum) return;
    new daum.Postcode({ oncomplete: handleComplete }).open();
  }

  return (
    <div className="flex flex-col gap-1">
      <Script src={POSTCODE_SRC} strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setFailed(true)} />
      <button
        type="button"
        onClick={open}
        disabled={!ready || pending}
        className="self-start rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {pending ? "좌표 확인 중..." : "주소 검색"}
      </button>
      {failed && <p className="text-sm text-red-600">주소 검색 스크립트를 불러오지 못했습니다. 주소를 직접 입력해 주세요.</p>}
      {noCoords && <p className="text-sm text-amber-700">좌표를 찾지 못했습니다. 위도·경도를 직접 입력해 주세요.</p>}
    </div>
  );
}
