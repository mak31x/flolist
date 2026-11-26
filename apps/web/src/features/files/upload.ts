import {
  apiErrorSchema,
  fileSchema,
  uploadTicketSchema,
  type FileDto,
  uuidv7,
  type UploadMime,
} from "@flolist/shared";

export class UploadError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "UploadError";
    this.code = code;
  }
}

async function failure(res: Response, fallback: string): Promise<UploadError> {
  const parsed = apiErrorSchema.safeParse(await res.json().catch(() => null));
  return parsed.success
    ? new UploadError(parsed.data.error.message, parsed.data.error.code)
    : new UploadError(fallback);
}

/**
 * Uploads a file into a workspace in three steps (D-037): reserve it and get a presigned
 * PUT, send the bytes straight to object storage, then ask the API to check and finish it.
 */
export async function uploadFile(
  blob: Blob,
  opts: {
    workspaceId: string;
    filename: string;
    mime: UploadMime;
    width?: number;
    height?: number;
    /** Upload progress, 0–1 (the PUT then goes through XHR, which reports it). */
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  },
): Promise<FileDto> {
  const reserve = await fetch("/api/v1/uploads", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: uuidv7(),
      workspaceId: opts.workspaceId,
      filename: opts.filename,
      mime: opts.mime,
      sizeBytes: blob.size,
      ...(opts.width ? { width: opts.width } : {}),
      ...(opts.height ? { height: opts.height } : {}),
    }),
  });
  if (!reserve.ok) throw await failure(reserve, "Couldn't start the upload");
  const ticket = uploadTicketSchema.parse(await reserve.json());

  const { onProgress, signal } = opts;
  if (onProgress) {
    await putWithProgress(ticket.upload, blob, onProgress, signal);
  } else {
    const put = await fetch(ticket.upload.url, {
      method: ticket.upload.method,
      headers: ticket.upload.headers,
      body: blob,
      ...(signal ? { signal } : {}),
    });
    if (!put.ok) throw new UploadError("The upload didn't go through");
  }

  const complete = await fetch(`/api/v1/uploads/${ticket.file.id}/complete`, {
    method: "POST",
    credentials: "include",
  });
  if (!complete.ok) throw await failure(complete, "Couldn't finish the upload");
  return fileSchema.parse(await complete.json());
}

/** `fetch` can't report upload progress; XHR can (and Tauri/Capacitor webviews have it). */
function putWithProgress(
  upload: { url: string; method: string; headers: Record<string, string> },
  blob: Blob,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    // Same-origin relay uploads need the session cookie; presigned URLs ignore it.
    xhr.withCredentials = upload.url.startsWith("/");
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new UploadError("The upload didn't go through"));
    };
    xhr.onerror = () => {
      reject(new UploadError("The upload didn't go through"));
    };
    xhr.onabort = () => {
      reject(new UploadError("The upload was cancelled", "ABORTED"));
    };
    signal?.addEventListener("abort", () => {
      xhr.abort();
    });
    xhr.send(blob);
  });
}
