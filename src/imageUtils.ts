import { saveAs } from 'file-saver';

export async function compressAndResizeImage(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality: number
): Promise<string> {
  return uploadFile(file);
}

export function compressImage(file: File, callback: (dataUrl: string, size: string) => void) {
  uploadFile(file).then(url => {
    const sizeStr = file.size > 1024 * 1024 
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` 
      : `${(file.size / 1024).toFixed(1)} KB`;
    callback(url, sizeStr);
  }).catch(err => {
    console.error("Error uploading image in compressImage helper:", err);
    alert(err.message || "خطا در بارگذاری فایل");
  });
}

export async function downloadFileFromServer(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Network response was not ok");
    const blob = await response.blob();
    saveAs(blob, filename);
  } catch (err) {
    console.warn("Blob download failed, falling back to direct link:", err);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Uploads a file and returns the URL it was stored under.
 *
 * `folder` files it into a subfolder of `uploads/`. The server sanitizes the
 * name to `[a-zA-Z0-9_-]`, so it must be **Latin** — a Persian folder name
 * sanitizes down to an empty string and the file silently lands in the uploads
 * root instead. The Persian folder names users see (the project documents tab)
 * are a separate, logical grouping stored on the record, not directories.
 */
export async function uploadFile(file: File, folder?: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const query = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  const response = await fetch(`/api/upload${query}`, {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });

  if (response.status === 401) {
    throw new Error("نشست شما منقضی شده است. لطفاً دوباره وارد سامانه شوید.");
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "خطا در بارگذاری فایل در سرور");
  }

  const data = await response.json();
  if (data && data.success && data.url) {
    return data.url;
  }
  throw new Error("پاسخ نامعتبر از سرور");
}
