"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { photoBucket } from "@/lib/photo-url";
import { createPhotoUploadAction, registerPhotoAction, removePhotoAction, reorderPhotosAction } from "../actions/photos";
import { ConfirmButton } from "./ConfirmButton";

export type PhotoItem = { id: string; url: string };

const ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024; // mirrors PHOTO_UPLOAD_MAX_BYTES; the server checks again
const MAX_PHOTOS = 20;

let browserClient: SupabaseClient | null = null;
/** Anon client used only to put files to server-issued signed upload URLs. */
function uploadClient(): SupabaseClient {
  browserClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return browserClient;
}

/** Signed URL → direct upload to Storage → register (the server checks the bytes). */
async function uploadOne(kind: "house" | "room", ownerId: string, file: File): Promise<string | null> {
  const signed = await createPhotoUploadAction(kind, ownerId, { contentType: file.type, size: file.size });
  if (!signed.ok) return signed.error ?? "업로드하지 못했습니다.";
  const { error } = await uploadClient()
    .storage.from(photoBucket())
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) return "저장소에 올리지 못했습니다. 잠시 후 다시 시도해 주세요.";
  const r = await registerPhotoAction(kind, ownerId, signed.path);
  return r.ok ? null : (r.error ?? "업로드하지 못했습니다.");
}

/** Photo list (first one is the cover) with upload, up/down reordering and delete. */
export function PhotoManager({
  kind,
  ownerId,
  photos,
}: {
  kind: "house" | "room";
  ownerId: string;
  photos: PhotoItem[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [reordering, startReorder] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  function upload() {
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) {
      setErrors(["올릴 사진을 선택해 주세요."]);
      return;
    }
    setErrors([]);
    startUpload(async () => {
      const failed: string[] = [];
      let done = 0;
      // Files go straight to Storage; the server only issues the URL and checks the result.
      for (const [i, file] of files.entries()) {
        setProgress(`${i + 1} / ${files.length} 업로드 중…`);
        if (file.size > MAX_BYTES) {
          failed.push(`${file.name}: 사진은 한 장에 10MB 이하만 올릴 수 있습니다.`);
          continue;
        }
        try {
          const error = await uploadOne(kind, ownerId, file);
          if (error === null) done++;
          else failed.push(`${file.name}: ${error}`);
        } catch {
          failed.push(`${file.name}: 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.`);
        }
      }
      setProgress(done > 0 ? `${done}장을 올렸습니다.` : null);
      setErrors(failed);
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function move(index: number, delta: -1 | 1) {
    const ids = photos.map((p) => p.id);
    const target = index + delta;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    startReorder(async () => {
      const r = await reorderPhotosAction(kind, ownerId, ids);
      setErrors(r.ok ? [] : [r.error ?? "순서를 바꾸지 못했습니다."]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {photos.length === 0 ? (
        <p className="text-sm text-zinc-500">등록된 사진이 없습니다. 첫 번째 사진이 대표 사진이 됩니다.</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p, i) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-2">
              <div className="relative aspect-[4/3] overflow-hidden rounded bg-zinc-100">
                {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL, admin preview only */}
                <img src={p.url} alt={`사진 ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                {i === 0 && (
                  <span className="absolute left-1 top-1 rounded bg-zinc-900/80 px-1.5 py-0.5 text-xs text-white">대표</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="secondary"
                  className="px-2.5 py-1 text-xs"
                  aria-label={`사진 ${i + 1} 앞으로`}
                  disabled={i === 0 || reordering}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  className="px-2.5 py-1 text-xs"
                  aria-label={`사진 ${i + 1} 뒤로`}
                  disabled={i === photos.length - 1 || reordering}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
              </div>
              <ConfirmButton
                size="sm"
                label="삭제"
                question="이 사진을 지울까요?"
                onConfirm={() => removePhotoAction(kind, p.id)}
              />
            </li>
          ))}
        </ol>
      )}

      {photos.length < MAX_PHOTOS ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            aria-label="사진 파일"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
          />
          <Button variant="secondary" pending={uploading} onClick={upload}>
            사진 올리기
          </Button>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">사진은 최대 {MAX_PHOTOS}장까지 올릴 수 있습니다.</p>
      )}
      <p className="text-xs text-zinc-500">JPG, PNG, WEBP · 한 장에 10MB 이하 · 최대 {MAX_PHOTOS}장</p>
      {progress && (
        <p role="status" className="text-sm text-zinc-700">
          {progress}
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="whitespace-pre-line text-sm text-red-700">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
