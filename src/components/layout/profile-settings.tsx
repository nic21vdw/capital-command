"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAppData } from "@/components/providers/app-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Reads an image file and downscales it to a small square-ish data URL so the
 *  avatar stays well under the stored-settings size cap. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const sourceUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = sourceUrl;
  });

  const max = 256;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return sourceUrl;
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function ProfileSettings() {
  const { data, mutate } = useAppData();
  const profile = data.settings.profile;
  const [name, setName] = useState(profile?.displayName ?? "");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const avatar = profile?.avatar;
  const trimmedName = name.trim();

  const saveProfile = (next: { displayName?: string; avatar?: string }) =>
    mutate(
      "updateSettings",
      { ...data.settings, profile: { ...data.settings.profile, ...next } },
      { successMessage: "Profile updated." }
    );

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    setUploading(true);
    try {
      const avatarDataUrl = await fileToAvatarDataUrl(file);
      await saveProfile({ avatar: avatarDataUrl });
    } catch {
      toast.error("Could not process that image.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card>
      <h2 className="text-xl font-semibold text-white">Profile</h2>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        Set the name and picture shown in the profile bar at the top of every page.
      </p>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <span className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[var(--accent)] text-2xl font-semibold text-[var(--accent-contrast)]">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              trimmedName.slice(0, 1).toUpperCase() || "?"
            )}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : avatar ? "Change photo" : "Upload photo"}
            </Button>
            {avatar ? (
              <Button variant="ghost" onClick={() => void saveProfile({ avatar: undefined })} disabled={uploading}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex-1">
          <p className="mb-2 text-sm text-[var(--muted-foreground)]">Display name</p>
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" maxLength={60} />
          <div className="mt-3">
            <Button
              onClick={() => void saveProfile({ displayName: trimmedName })}
              disabled={trimmedName === (profile?.displayName ?? "").trim()}
            >
              Save name
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
