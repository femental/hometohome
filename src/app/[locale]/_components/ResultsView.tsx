"use client";

import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

const TAB = "flex-1 rounded-md px-3 py-1.5 text-sm font-medium";

/**
 * Results layout: list left and map right from `lg` up; below that a List/Map switch shows one pane.
 * Both panes stay mounted so the map keeps its state while toggling.
 */
export function ResultsView({ list, map }: { list: ReactNode; map: ReactNode }) {
  const t = useTranslations("search");
  const [tab, setTab] = useState<"list" | "map">("list");

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={t("viewToggle")} className="flex gap-1 rounded-lg bg-zinc-100 p-1 lg:hidden">
        {(["list", "map"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`${TAB} ${tab === id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600"}`}
          >
            {t(id === "list" ? "listTab" : "mapTab")}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className={tab === "list" ? "" : "hidden lg:block"}>{list}</div>
        <div
          className={`${tab === "map" ? "" : "hidden lg:block"} h-[65vh] min-h-72 lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]`}
        >
          {map}
        </div>
      </div>
    </div>
  );
}
