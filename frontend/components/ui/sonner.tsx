"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      theme="light"
      richColors
      toastOptions={{
        style: {
          fontSize: "0.95rem",
        },
      }}
    />
  );
}
