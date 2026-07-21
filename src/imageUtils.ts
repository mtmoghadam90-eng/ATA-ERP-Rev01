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

export async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

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
