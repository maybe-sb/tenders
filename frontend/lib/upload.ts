import { PresignedUpload } from "@/types/tenders";

export async function uploadToPresignedUrl(upload: PresignedUpload, file: File) {
  const formData = new FormData();
  if (upload.fields) {
    Object.entries(upload.fields).forEach(([key, value]) => {
      formData.append(key, value);
    });
  }
  formData.append("file", file);

  const response = await fetch(upload.uploadUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${response.status} ${text}`);
  }
}
