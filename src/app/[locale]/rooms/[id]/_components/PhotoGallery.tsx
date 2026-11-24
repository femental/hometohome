"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { useState } from "react";
import type { PublicPhoto } from "@/server/guest/catalog";

const NAV =
  "absolute top-1/2 -translate-y-1/2 rounded-full bg-white/90 px-3 py-1.5 text-lg leading-none text-zinc-900 shadow hover:bg-white focus-visible:outline-2 focus-visible:outline-zinc-900";

/** Main photo with previous/next buttons and a scrollable thumbnail strip. Used by the room and house pages. */
export function PhotoGallery({ photos }: { photos: PublicPhoto[] }) {
  const t = useTranslations("room");
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-zinc-100 text-sm text-zinc-400 sm:aspect-[16/9]">
        {t("noPhotos")}
      </div>
    );
  }

  const current = photos[Math.min(index, photos.length - 1)];
  const go = (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-zinc-100 sm:aspect-[16/9]">
        <Image
          src={current.url}
          alt={current.alt}
          fill
          priority={index === 0}
          sizes="(min-width: 1024px) 640px, 100vw"
          className="object-cover"
        />
        {photos.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label={t("previousPhoto")} className={`${NAV} left-2`}>
              ‹
            </button>
            <button type="button" onClick={() => go(1)} aria-label={t("nextPhoto")} className={`${NAV} right-2`}>
              ›
            </button>
            <p aria-live="polite" className="absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
              {t("photoCount", { current: index + 1, total: photos.length })}
            </p>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((p, i) => (
            <li key={`${p.url}-${i}`} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t("showPhoto", { number: i + 1 })}
                aria-current={i === index || undefined}
                className={`relative block h-14 w-20 overflow-hidden rounded border-2 ${i === index ? "border-zinc-900" : "border-transparent opacity-70 hover:opacity-100"}`}
              >
                <Image src={p.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
