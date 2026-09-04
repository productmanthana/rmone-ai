/**
 * AWS S3 helpers for the onboarding pipeline.
 * Credentials use the AWS default provider chain: environment credentials in
 * local development and the attached IAM role on Elastic Beanstalk.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

function getClient(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    // The bucket may live in a different region than AWS_REGION says
    // (e.g. autoonboardings is in us-east-2); follow S3's 301 redirect.
    followRegionRedirects: true,
  });
}

/**
 * Onboarding files live in an APP-OWNED bucket. The client-provided
 * AWS_S3_BUCKET (autoonboardings, us-east-2) is read-only for our
 * credentials — every PutObject fails with AccessDenied — which is why
 * historical jobs all have s3Key = null. Same pattern as the
 * data-cleaning store: create our own bucket on first use.
 */
function getBucket(): string {
  return process.env.ONBOARDING_S3_BUCKET || "rmone-onboarding";
}

/** Create the bucket if it doesn't exist yet (single-flight, race-safe). */
let ensured: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const client = getClient();
      const bucket = getBucket();
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return;
      } catch {
        /* fall through to create */
      }
      const region = process.env.AWS_REGION ?? "us-east-1";
      try {
        await client.send(new CreateBucketCommand({
          Bucket: bucket,
          ...(region !== "us-east-1"
            ? { CreateBucketConfiguration: { LocationConstraint: region as never } }
            : {}),
        }));
      } catch (e) {
        const name = (e as { name?: string }).name ?? "";
        // Another worker (or a previous run) won the race — that's fine.
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw e;
      }
    })().catch(e => { ensured = null; throw e; });
  }
  return ensured;
}

export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  await ensureBucket();
  const client = getClient();
  await client.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return key;
}

export async function getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn },
  );
}

export async function deleteFile(key: string): Promise<void> {
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
}

export async function readFileBuffer(key: string): Promise<Buffer> {
  const client = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  const stream = res.Body as Readable;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end",  () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

export function buildS3Key(tenantId: string, uploadId: string, filename: string, suffix = ""): string {
  const ts = new Date().toISOString().split("T")[0];
  return `onboarding/${tenantId}/${ts}/${uploadId}${suffix ? "-" + suffix : ""}/${filename}`;
}

export function storageStatus(): { configured: boolean; message: string } {
  return { configured: true, message: "S3 configured via AWS credential chain" };
}
