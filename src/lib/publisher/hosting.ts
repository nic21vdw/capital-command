import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { hostingConfigured, publisherConfig, type PublisherConfig } from "@/lib/publisher/config";

/**
 * Media hosting behind a small interface so the provider can be swapped.
 *
 * Instagram's Content Publishing API downloads the video from a public HTTPS
 * URL, so those clips must be hosted somewhere first. The bundled
 * implementation targets any S3-compatible store; Cloudflare R2's free tier
 * (10 GB storage, no egress fees) keeps this at $0. TikTok uses direct
 * FILE_UPLOAD by default, so hosting is optional there.
 */

export interface MediaHost {
  /** Uploads a local file and returns the object key. */
  upload(localPath: string, key: string): Promise<string>;
  /**
   * Returns a public HTTPS URL for the object. Presigned URLs are minted
   * fresh per call (they expire), so always request one at publish time.
   */
  publicUrl(key: string): Promise<string>;
  /** Downloads the object to a local path (used by the GitHub Actions runner). */
  download(key: string, destPath: string): Promise<void>;
  getObjectText(key: string): Promise<string | null>;
  putObjectText(key: string, text: string): Promise<void>;
  describe(): string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".json": "application/json"
};

export class S3MediaHost implements MediaHost {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | null;

  constructor(s3: PublisherConfig["s3"]) {
    if (!s3.endpoint || !s3.bucket || !s3.accessKeyId || !s3.secretAccessKey) {
      throw new Error("Media hosting is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
    }
    this.bucket = s3.bucket;
    this.publicBaseUrl = s3.publicBaseUrl?.replace(/\/+$/, "") ?? null;
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
      // R2 and most S3 clones expect path-style with custom endpoints.
      forcePathStyle: true
    });
  }

  describe(): string {
    return `s3://${this.bucket}`;
  }

  async upload(localPath: string, key: string): Promise<string> {
    const info = await stat(localPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(localPath),
        ContentLength: info.size,
        ContentType: CONTENT_TYPES[path.extname(localPath).toLowerCase()] ?? "application/octet-stream"
      })
    );
    return key;
  }

  async publicUrl(key: string): Promise<string> {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
    }
    // 12 hours comfortably covers Instagram's container download plus retries.
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: 12 * 60 * 60
    });
  }

  async download(key: string, destPath: string): Promise<void> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`Object ${key} has no body.`);
    await pipeline(result.Body as NodeJS.ReadableStream, createWriteStream(destPath));
  }

  async getObjectText(key: string): Promise<string | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return result.Body ? await result.Body.transformToString() : null;
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw error;
    }
  }

  async putObjectText(key: string, text: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: text,
        ContentType: "application/json"
      })
    );
  }
}

let cachedHost: MediaHost | null = null;

/** The configured media host, or null when hosting is not set up. */
export function mediaHost(config = publisherConfig()): MediaHost | null {
  if (!hostingConfigured(config)) return null;
  if (!cachedHost) cachedHost = new S3MediaHost(config.s3);
  return cachedHost;
}

/** Stable object key for a queue item's media. */
export function mediaKeyFor(itemId: string, clipPath: string): string {
  return `publisher/media/${itemId}/${path.basename(clipPath)}`;
}

/**
 * host_media(clip_path) -> public_url. Uploads the clip (if hosting is
 * configured) and returns a URL Instagram/TikTok can pull from.
 */
export async function hostMedia(clipPath: string, itemId: string): Promise<{ key: string; url: string }> {
  const host = mediaHost();
  if (!host) {
    throw new Error(
      "Instagram publishing needs a public video URL, but media hosting is not configured. Set the S3_* variables (Cloudflare R2 free tier works)."
    );
  }
  const key = await host.upload(clipPath, mediaKeyFor(itemId, clipPath));
  const url = await host.publicUrl(key);
  return { key, url };
}
