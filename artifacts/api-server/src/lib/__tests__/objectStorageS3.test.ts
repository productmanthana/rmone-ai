import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectNotFoundError,
  ObjectStorageService,
  objectPathToS3Key,
  publicPathToS3Key,
} from "../objectStorage";

async function run(): Promise<void> {
  assert.equal(
    objectPathToS3Key("/objects/uploads/file-id"),
    "objects/uploads/file-id",
  );
  assert.equal(publicPathToS3Key("branding/logo.svg"), "public/branding/logo.svg");
  assert.throws(
    () => objectPathToS3Key("/objects/../private-file"),
    ObjectNotFoundError,
  );
  assert.throws(
    () => publicPathToS3Key("../objects/private-file"),
    ObjectNotFoundError,
  );

  const sent: unknown[] = [];
  let signedCommand: PutObjectCommand | undefined;
  const fakeClient = {
    send: async (command: unknown) => {
      sent.push(command);
      if (command instanceof GetObjectCommand) {
        return {
          Body: Readable.from([Buffer.from("hello")]),
          ContentType: "text/plain",
          ContentLength: 5,
          ETag: '"test-etag"',
        };
      }
      return {};
    },
  } as unknown as S3Client;
  const fakeSigner = (async (
    _client: S3Client,
    command: PutObjectCommand,
  ) => {
    signedCommand = command;
    return "https://uploads.example.test/signed";
  }) as typeof getSignedUrl;

  const service = new ObjectStorageService({
    bucketName: "rmone-test-files",
    client: fakeClient,
    createObjectId: () => "fixed-id",
    signUrl: fakeSigner,
  });

  const target = await service.createObjectEntityUpload("application/pdf");
  assert.deepEqual(target, {
    uploadURL: "https://uploads.example.test/signed",
    objectPath: "/objects/uploads/fixed-id",
  });
  assert.ok(signedCommand instanceof PutObjectCommand);
  assert.deepEqual(signedCommand.input, {
    Bucket: "rmone-test-files",
    Key: "objects/uploads/fixed-id",
    ContentType: "application/pdf",
  });

  const stored = await service.getObjectEntityFile(
    "/objects/uploads/fixed-id",
  );
  assert.equal(stored.visibility, "private");
  assert.ok(sent.some((command) => command instanceof HeadObjectCommand));

  const response = await service.downloadObject(stored);
  assert.equal(await response.text(), "hello");
  assert.equal(response.headers.get("content-type"), "text/plain");
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(response.headers.get("cache-control"), "private, max-age=3600");

  const missingClient = {
    send: async () => {
      throw Object.assign(new Error("missing"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      });
    },
  } as unknown as S3Client;
  const missingService = new ObjectStorageService({
    bucketName: "rmone-test-files",
    client: missingClient,
  });
  await assert.rejects(
    () => missingService.getObjectEntityFile("/objects/uploads/missing"),
    ObjectNotFoundError,
  );
  assert.equal(await missingService.searchPublicObject("missing.svg"), null);

  console.log("S3 object storage checks passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});