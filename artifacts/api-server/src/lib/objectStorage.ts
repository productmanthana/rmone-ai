import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

const DEFAULT_CACHE_TTL_SEC = 3600;
const UPLOAD_URL_TTL_SEC = 900;
const PUBLIC_PREFIX = "public/";
const OBJECT_PREFIX = "objects/";

export const objectStorageClient = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  followRegionRedirects: true,
});

export interface StoredObject {
  bucketName: string;
  objectName: string;
  visibility: "public" | "private";
}

interface ObjectStorageServiceOptions {
  bucketName?: string;
  client?: S3Client;
  createObjectId?: () => string;
  signUrl?: typeof getSignedUrl;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export function getObjectStorageBucket(): string {
  const bucketName =
    process.env.OBJECT_STORAGE_S3_BUCKET?.trim() ||
    process.env.AWS_S3_BUCKET?.trim() ||
    "";
  if (!bucketName) {
    throw new Error(
      "S3 object storage is not configured. Set OBJECT_STORAGE_S3_BUCKET or AWS_S3_BUCKET.",
    );
  }
  return bucketName;
}

function normalizeRelativePath(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    parts.some(
      (part) => !part || part === "." || part === ".." || part.includes("\0"),
    )
  ) {
    throw new ObjectNotFoundError();
  }
  return parts.join("/");
}

export function publicPathToS3Key(filePath: string): string {
  return `${PUBLIC_PREFIX}${normalizeRelativePath(filePath)}`;
}

export function objectPathToS3Key(objectPath: string): string {
  if (!objectPath.startsWith("/objects/")) {
    throw new ObjectNotFoundError();
  }
  const entityId = normalizeRelativePath(objectPath.slice("/objects/".length));
  return `${OBJECT_PREFIX}${entityId}`;
}

function isNotFoundError(error: unknown): boolean {
  const value = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    value?.name === "NoSuchKey" ||
    value?.name === "NoSuchBucket" ||
    value?.name === "NotFound" ||
    value?.$metadata?.httpStatusCode === 404
  );
}

export class ObjectStorageService {
  private readonly bucketName: string;
  private readonly client: S3Client;
  private readonly createObjectId: () => string;
  private readonly signUrl: typeof getSignedUrl;

  constructor(options: ObjectStorageServiceOptions = {}) {
    this.bucketName = options.bucketName || getObjectStorageBucket();
    this.client = options.client || objectStorageClient;
    this.createObjectId = options.createObjectId || randomUUID;
    this.signUrl = options.signUrl || getSignedUrl;
  }

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    let objectName: string;
    try {
      objectName = publicPathToS3Key(filePath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return null;
      throw error;
    }

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: objectName,
        }),
      );
      return {
        bucketName: this.bucketName,
        objectName,
        visibility: "public",
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async downloadObject(
    file: StoredObject,
    cacheTtlSec: number = DEFAULT_CACHE_TTL_SEC,
  ): Promise<Response> {
    let result;
    try {
      result = await this.client.send(
        new GetObjectCommand({
          Bucket: file.bucketName,
          Key: file.objectName,
        }),
      );
    } catch (error) {
      if (isNotFoundError(error)) throw new ObjectNotFoundError();
      throw error;
    }

    if (!result.Body) {
      throw new ObjectNotFoundError();
    }

    const body = result.Body as Readable;
    const webStream = Readable.toWeb(body) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type": result.ContentType || "application/octet-stream",
      "Cache-Control": `${file.visibility}, max-age=${cacheTtlSec}`,
    };
    if (result.ContentLength !== undefined) {
      headers["Content-Length"] = String(result.ContentLength);
    }
    if (result.ETag) {
      headers.ETag = result.ETag;
    }

    return new Response(webStream, { headers });
  }

  async createObjectEntityUpload(
    contentType: string,
  ): Promise<{ uploadURL: string; objectPath: string }> {
    const objectPath = `/objects/uploads/${this.createObjectId()}`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: objectPathToS3Key(objectPath),
      ContentType: contentType,
    });
    const uploadURL = await this.signUrl(this.client, command, {
      expiresIn: UPLOAD_URL_TTL_SEC,
    });
    return { uploadURL, objectPath };
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    const objectName = objectPathToS3Key(objectPath);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: objectName,
        }),
      );
    } catch (error) {
      if (isNotFoundError(error)) throw new ObjectNotFoundError();
      throw error;
    }

    return {
      bucketName: this.bucketName,
      objectName,
      visibility: "private",
    };
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/objects/")) {
      objectPathToS3Key(rawPath);
      return rawPath;
    }

    try {
      const url = new URL(rawPath);
      const marker = "/objects/";
      const markerIndex = url.pathname.indexOf(marker);
      if (markerIndex >= 0) {
        const objectPath = url.pathname.slice(markerIndex);
        objectPathToS3Key(objectPath);
        return objectPath;
      }
    } catch {
      // The caller may be passing an already-normalized non-URL value.
    }
    return rawPath;
  }
}