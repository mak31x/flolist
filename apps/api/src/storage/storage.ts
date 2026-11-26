import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GENERIC_MIME, isInlineImage } from "@flolist/shared";

/**
 * Object storage behind presigned URLs (D-012, D-018, D-037). S3-generic on purpose:
 * RustFS in dev, OCI Object Storage in prod, AWS SDK v3 with path-style addressing.
 */
export interface Storage {
  /** A URL the browser PUTs the bytes to; `headers` must be sent as given. */
  presignPut(
    key: string,
    opts: { mime: string; expiresIn: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(
    key: string,
    opts: { expiresIn: number; filename: string; mime: string },
  ): Promise<string>;
  /** Stores bytes the API received itself (relay mode). */
  put(key: string, body: Uint8Array, mime: string): Promise<void>;
  /** Size and stored content type, or null if there's no such object. */
  head(key: string): Promise<{ size: number; contentType: string | undefined } | null>;
  /** The first `length` bytes of the object. */
  readStart(key: string, length: number): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export interface S3Config {
  /** Endpoint the API talks to (may be a Docker-internal host). */
  endpoint: string;
  /** Endpoint browsers reach; presigned URLs are signed for this host. Defaults to `endpoint`. */
  publicEndpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function client(endpoint: string, cfg: S3Config): S3Client {
  return new S3Client({
    endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // The SDK's default CRC32 checksums end up in presigned URLs, which browsers can't
    // satisfy and some S3-compatible servers (OCI) reject. Only send them when required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** RFC 6266 `inline` disposition with an ASCII fallback and a UTF-8 filename. */
/**
 * Only the inline image types (checked by magic bytes on upload) open in the browser; every
 * other file downloads, so an uploaded HTML or SVG file never renders from the bucket.
 */
export function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function createS3Storage(cfg: S3Config): Storage {
  const s3 = client(cfg.endpoint, cfg);
  const signer = cfg.publicEndpoint ? client(cfg.publicEndpoint, cfg) : s3;
  const Bucket = cfg.bucket;

  return {
    async presignPut(key, { mime, expiresIn }) {
      const url = await getSignedUrl(
        signer,
        new PutObjectCommand({ Bucket, Key: key, ContentType: mime }),
        { expiresIn, signableHeaders: new Set(["content-type"]) },
      );
      return { url, headers: { "content-type": mime } };
    },

    presignGet(key, { expiresIn, filename, mime }) {
      return getSignedUrl(
        signer,
        new GetObjectCommand({
          Bucket,
          Key: key,
          // Non-images are served as opaque bytes, whatever type was declared.
          ResponseContentType: isInlineImage(mime) ? mime : GENERIC_MIME,
          ResponseContentDisposition: contentDisposition(filename, isInlineImage(mime)),
          ResponseCacheControl: "private, max-age=3600, immutable",
        }),
        { expiresIn },
      );
    },

    async put(key, body, mime) {
      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: mime,
          ContentLength: body.byteLength,
        }),
      );
    },

    async head(key) {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (err) {
        if (err instanceof NotFound) return null;
        if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async readStart(key, length) {
      const res = await s3.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${String(length - 1)}` }),
      );
      if (!res.Body) return new Uint8Array();
      return res.Body.transformToByteArray();
    },

    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
