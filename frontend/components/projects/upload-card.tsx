"use client";

import { ChangeEvent, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface UploadCardProps {
  title: string;
  description: string;
  accept: string;
  onSelectFile: (file: File) => Promise<void>;
  disabled?: boolean;
}

export function UploadCard({ title, description, accept, onSelectFile, disabled }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPending(true);
    try {
      await onSelectFile(file);
    } finally {
      setPending(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <Input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileInput}
          disabled={pending || disabled}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
          disabled={pending || disabled}
        >
          <Upload className="mr-2 h-4 w-4" />
          {pending ? "Uploading..." : "Select"}
        </Button>
      </CardContent>
    </Card>
  );
}
