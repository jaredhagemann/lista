"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ClubLogoUploadProps {
  orgId: string;
  currentLogoUrl: string | null;
  onUpload: (logoUrl: string, faviconUrl: string) => void;
  onRemove: () => void;
}

function centerCropToSquare(file: File, outputSize: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not supported"));
        return;
      }
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, outputSize, outputSize);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
        "image/png"
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image failed to load"));
    };
    img.src = objectUrl;
  });
}

export function ClubLogoUpload({
  orgId,
  currentLogoUrl,
  onUpload,
  onRemove,
}: ClubLogoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const logoPath = `${orgId}/logo-${crypto.randomUUID()}.${ext}`;
      const faviconPath = `${orgId}/favicon-${crypto.randomUUID()}.png`;

      const { error: logoError } = await supabase.storage
        .from("org-images")
        .upload(logoPath, file, { upsert: true });
      if (logoError) {
        toast.error(logoError.message);
        return;
      }

      const faviconBlob = await centerCropToSquare(file, 64);
      const { error: faviconError } = await supabase.storage
        .from("org-images")
        .upload(faviconPath, faviconBlob, {
          upsert: true,
          contentType: "image/png",
        });
      if (faviconError) {
        toast.error(faviconError.message);
        return;
      }

      const { data: logoData } = supabase.storage
        .from("org-images")
        .getPublicUrl(logoPath);
      const { data: faviconData } = supabase.storage
        .from("org-images")
        .getPublicUrl(faviconPath);

      onUpload(logoData.publicUrl, faviconData.publicUrl);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="relative flex items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted transition-colors hover:border-muted-foreground/50 disabled:opacity-50"
        style={{ width: 160, height: 48 }}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : currentLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentLogoUrl}
            alt="Club logo"
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Camera className="h-5 w-5" />
            <span className="text-xs">Upload logo</span>
          </span>
        )}
      </button>

      {currentLogoUrl && !uploading && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
