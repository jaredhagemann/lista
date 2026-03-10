"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Camera, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface ImageUploadProps {
  bucket: string;
  folder: string;
  currentUrl: string | null;
  onUpload: (url: string | null) => void;
  shape?: "circle" | "rounded";
  width?: number;
  height?: number;
}

export function ImageUpload({
  bucket,
  folder,
  currentUrl,
  onUpload,
  shape = "circle",
  width = 80,
  height = 80,
}: ImageUploadProps) {
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
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: true });

      if (uploadError) {
        toast.error(uploadError.message);
        return;
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onUpload(data.publicUrl);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleRemove() {
    onUpload(null);
  }

  const shapeClass = shape === "circle" ? "rounded-full" : "rounded-lg";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={`relative flex items-center justify-center overflow-hidden border-2 border-dashed border-muted-foreground/25 bg-muted hover:border-muted-foreground/50 transition-colors ${shapeClass}`}
        style={{ width, height }}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : currentUrl ? (
          <img
            src={currentUrl}
            alt="Upload"
            className="h-full w-full object-cover"
          />
        ) : (
          <Camera className="h-6 w-6 text-muted-foreground" />
        )}
      </button>

      {currentUrl && !uploading && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleRemove}
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
