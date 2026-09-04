/**
 * Data Cleaning Assistant — session persistence (S3).
 *
 * State lives in the app-owned S3 bucket (default: rmone-data-cleaning),
 * which we created with the app's own IAM credentials — unlike the
 * onboarding bucket (autoonboardings), whose bucket policy denies writes.
 * Both cluster workers read the same bucket, so ANY worker can answer
 * status polls and downloads regardless of which worker ran the cleaning.
 *
 * Key layout (tenant id is part of every key — reads are always scoped
 * to tenant + session, same guarantee as the old SQL WHERE clause):
 *   data-cleaning/<tenantId>/<sessionId>/status.json
 *   data-cleaning/<tenantId>/<sessionId>/report.json
 *   data-cleaning/<tenantId>/<sessionId>/cleaned.xlsx
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { CleaningReport } from "./engine.js";

/** Compact per-session totals shown in the History list. */
export interface DcSummary {
  sheets: number;   // template tabs recognised
  rowsIn: number;   // data rows read from those tabs
  rowsOut: number;  // rows kept in the cleaned file
  fixed: number;    // values reformatted (dates/numbers/emails/IDs)
  dupes: number;    // duplicate rows removed
  review: number;   // total Needs Review items
  fix: number;      // level: action needed
  check: number;    // level: worth checking
  info: number;     // level: FYI only
}

export interface DcStatus {
  stage: "queued" | "parsing" | "mapping" | "cleaning" | "cross-check" | "building" | "done" | "failed";
  pct: number;
  message: string;
  updatedAt: string;
  error?: string;
  fileName?: string;
  summary?: DcSummary;
  /** Set when the user finished the import review — a decisions-applied
      workbook (reviewed.xlsx) exists alongside cleaned.xlsx. */
  reviewedAt?: string;
}

const BUCKET = process.env.DATA_CLEANING_S3_BUCKET ?? "rmone-data-cleaning";
const REGION = process.env.AWS_REGION ?? "us-east-1";

let _client: S3Client | null = null;
function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: REGION,
      followRegionRedirects: true,
    });
  }
  return _client;
}

/** Create the bucket if it doesn't exist yet (single-flight, race-safe). */
let ensured: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      const client = getClient();
      try {
        await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
        return;
      } catch {
        /* fall through to create */
      }
      try {
        await client.send(new CreateBucketCommand({
          Bucket: BUCKET,
          ...(REGION !== "us-east-1"
            ? { CreateBucketConfiguration: { LocationConstraint: REGION as never } }
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

function keyFor(tenantId: string, sessionId: string, name: string): string {
  return `data-cleaning/${tenantId}/${sessionId}/${name}`;
}

async function putJson(key: string, value: unknown): Promise<void> {
  await ensureBucket();
  await getClient().send(new PutObjectCommand({
    Bucket: BUCKET, Key: key,
    Body: Buffer.from(JSON.stringify(value)),
    ContentType: "application/json",
  }));
}

async function getBuffer(key: string): Promise<Buffer | null> {
  await ensureBucket();
  try {
    const res = await getClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (name === "NoSuchKey" || name === "NotFound" || name === "NoSuchBucket") return null;
    throw e;
  }
}

async function getJson<T>(key: string): Promise<T | null> {
  const buf = await getBuffer(key);
  if (!buf) return null;
  try { return JSON.parse(buf.toString("utf8")) as T; } catch { return null; }
}

/**
 * The session's original file name is written once (first status write from
 * the upload handler) and preserved on later writes. The engine runs the whole
 * session in ONE worker, so a per-worker cache avoids a read-before-write on
 * every progress update; the S3 fallback covers cold paths.
 */
const fileNameCache = new Map<string, string>();
// Same idea for reviewedAt (null = "known absent", so we don't re-read S3 on
// every progress write). saveReviewedFile refreshes it on this worker.
const reviewedAtCache = new Map<string, string | null>();

/** Upsert the session's progress object. */
export async function writeStatus(tenantId: string, sessionId: string, s: DcStatus): Promise<void> {
  const cacheKey = `${tenantId}/${sessionId}`;
  let fileName = s.fileName ?? fileNameCache.get(cacheKey);
  let prev: DcStatus | null | undefined;
  if (!fileName) {
    prev = await getJson<DcStatus>(keyFor(tenantId, sessionId, "status.json"));
    fileName = prev?.fileName;
  }
  if (fileName) fileNameCache.set(cacheKey, fileName);

  // reviewedAt (stamped by saveReviewedFile after the run) must survive any
  // later status write — never rebuild status.json without carrying it over.
  let reviewedAt = s.reviewedAt ?? reviewedAtCache.get(cacheKey) ?? undefined;
  if (reviewedAt === undefined && !reviewedAtCache.has(cacheKey)) {
    if (prev === undefined) prev = await getJson<DcStatus>(keyFor(tenantId, sessionId, "status.json"));
    reviewedAt = prev?.reviewedAt;
  }
  reviewedAtCache.set(cacheKey, reviewedAt ?? null);

  const status: DcStatus = {
    stage: s.stage,
    pct: Math.max(0, Math.min(100, Math.round(s.pct))),
    message: (s.message ?? "").slice(0, 1000),
    updatedAt: new Date().toISOString(),
    ...(s.error ? { error: s.error } : {}),
    ...(fileName ? { fileName: fileName.slice(0, 400) } : {}),
    ...(s.summary ? { summary: s.summary } : {}),
    ...(reviewedAt ? { reviewedAt } : {}),
  };
  await putJson(keyFor(tenantId, sessionId, "status.json"), status);
}

export async function readStatus(tenantId: string, sessionId: string): Promise<DcStatus | null> {
  return getJson<DcStatus>(keyFor(tenantId, sessionId, "status.json"));
}

/** Persist the final artifacts. */
export async function saveResult(
  tenantId: string, sessionId: string,
  report: CleaningReport, cleaned: Buffer,
): Promise<void> {
  await ensureBucket();
  await Promise.all([
    putJson(keyFor(tenantId, sessionId, "report.json"), report),
    getClient().send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: keyFor(tenantId, sessionId, "cleaned.xlsx"),
      Body: cleaned,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })),
  ]);
}

export async function readReport(tenantId: string, sessionId: string): Promise<CleaningReport | null> {
  return getJson<CleaningReport>(keyFor(tenantId, sessionId, "report.json"));
}

export interface DcSessionMeta extends DcStatus {
  sessionId: string;
}

/**
 * List this tenant's cleaning sessions, newest first (by status.json
 * LastModified). Scans the tenant prefix, then fetches each status.json —
 * they are tiny (<1 KB), so even 60 parallel reads are cheap.
 */
export async function listSessions(tenantId: string, limit = 60): Promise<DcSessionMeta[]> {
  await ensureBucket();
  const client = getClient();
  const prefix = `data-cleaning/${tenantId}/`;
  const found: { key: string; lm: number }[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    for (const o of res.Contents ?? []) {
      if (o.Key?.endsWith("/status.json")) {
        found.push({ key: o.Key, lm: o.LastModified?.getTime() ?? 0 });
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token && found.length < 5000);

  found.sort((a, b) => b.lm - a.lm);
  const top = found.slice(0, Math.max(1, limit));
  const metas = await Promise.all(top.map(async ({ key }) => {
    const st = await getJson<DcStatus>(key);
    if (!st) return null;
    const sessionId = key.slice(prefix.length).split("/")[0] ?? "";
    if (!sessionId) return null;
    return { sessionId, ...st } as DcSessionMeta;
  }));
  return metas.filter((m): m is DcSessionMeta => m !== null);
}

export async function readCleanedFile(
  tenantId: string, sessionId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const [buffer, status] = await Promise.all([
    getBuffer(keyFor(tenantId, sessionId, "cleaned.xlsx")),
    getJson<DcStatus>(keyFor(tenantId, sessionId, "status.json")),
  ]);
  if (!buffer) return null;
  return { buffer, fileName: status?.fileName ?? "file.xlsx" };
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Keep the user's ORIGINAL upload next to the session artifacts so a
 * re-clean (user re-maps a dropped column) can re-run the engine without
 * asking the user to attach the file again. Non-fatal on failure — the
 * upload handler must never block cleaning on this write.
 */
export async function saveOriginalFile(
  tenantId: string, sessionId: string, buffer: Buffer,
): Promise<void> {
  await ensureBucket();
  await getClient().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: keyFor(tenantId, sessionId, "original.xlsx"),
    Body: buffer,
    ContentType: XLSX_MIME,
  }));
}

export async function readOriginalFile(
  tenantId: string, sessionId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const [buffer, status] = await Promise.all([
    getBuffer(keyFor(tenantId, sessionId, "original.xlsx")),
    getJson<DcStatus>(keyFor(tenantId, sessionId, "status.json")),
  ]);
  if (!buffer) return null;
  return { buffer, fileName: status?.fileName ?? "file.xlsx" };
}

/**
 * Persist the decisions-applied workbook the user finalized on the import
 * review screen. Overwrites on repeat finishes (latest decisions win) and
 * stamps reviewedAt on status.json so History can show a "Reviewed" download.
 */
export async function saveReviewedFile(
  tenantId: string, sessionId: string, buffer: Buffer,
): Promise<void> {
  await ensureBucket();
  await getClient().send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: keyFor(tenantId, sessionId, "reviewed.xlsx"),
    Body: buffer,
    ContentType: XLSX_MIME,
  }));
  const key = keyFor(tenantId, sessionId, "status.json");
  const st = await getJson<DcStatus>(key);
  const reviewedAt = new Date().toISOString();
  if (st) await putJson(key, { ...st, reviewedAt });
  reviewedAtCache.set(`${tenantId}/${sessionId}`, reviewedAt);
}

export async function readReviewedFile(
  tenantId: string, sessionId: string,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const [buffer, status] = await Promise.all([
    getBuffer(keyFor(tenantId, sessionId, "reviewed.xlsx")),
    getJson<DcStatus>(keyFor(tenantId, sessionId, "status.json")),
  ]);
  if (!buffer) return null;
  return { buffer, fileName: status?.fileName ?? "file.xlsx" };
}
