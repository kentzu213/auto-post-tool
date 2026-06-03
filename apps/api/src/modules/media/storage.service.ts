import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

/**
 * StorageService — S3-compatible object storage client (Req 11.1, 11.5).
 *
 * Configured from the Secret_Source via environment variables. MinIO is the
 * default target (internal `http://minio:9000`); Cloudflare R2 / AWS S3 work by
 * swapping `S3_ENDPOINT` + credentials, no code change.
 *
 * The S3Client is constructed once in the constructor from `process.env`, which
 * is populated for the dev server by apps/api/.env. This service is registered
 * and exported in media.module.ts; wiring it into the upload/serve paths happens
 * in tasks 6.2/6.3 (later).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  // Memoizes the lazy bucket-ensure so it runs at most once per process; the
  // promise is cached so concurrent callers await the same check.
  private bucketEnsured?: Promise<void>;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY;
    const secretAccessKey = process.env.S3_SECRET_KEY;
    const region = process.env.S3_REGION || 'us-east-1';
    // MinIO requires path-style addressing; default to true.
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false';

    this.bucket = process.env.S3_BUCKET_NAME ?? '';

    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });

    // Log configuration by key presence only — never the secret values.
    this.logger.log(
      `StorageService configured (endpoint=${endpoint ?? 'unset'}, region=${region}, bucket=${this.bucket || 'unset'}, forcePathStyle=${forcePathStyle})`,
    );
  }

  /**
   * Ensure the configured bucket exists before writing to it.
   *
   * Checks HeadBucket; if the bucket is missing, issues CreateBucket. The work
   * is memoized so it runs at most once per process (concurrent callers await
   * the same promise). Defensive: a "bucket already exists" race (another
   * process/replica created it first) is treated as success. If the check fails
   * for an unexpected reason the memo is cleared so a later putObject can retry.
   *
   * This makes uploads work against a fresh MinIO (where the bucket is not
   * pre-created) and lets the /health/ready storage probe flip to 'up' once the
   * first upload has run.
   */
  async ensureBucket(): Promise<void> {
    if (!this.bucketEnsured) {
      this.bucketEnsured = this.doEnsureBucket().catch((err) => {
        // Clear the memo on failure so a subsequent call can retry.
        this.bucketEnsured = undefined;
        throw err;
      });
    }
    return this.bucketEnsured;
  }

  private async doEnsureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return; // already exists
    } catch {
      // Bucket missing (or not yet visible) — attempt to create it.
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Created object storage bucket '${this.bucket}'.`);
    } catch (err) {
      // Tolerate the create race: another process/replica may have created it
      // between our HeadBucket and CreateBucket.
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') {
        return;
      }
      throw err;
    }
  }

  /**
   * Store an object in the bucket.
   */
  async putObject(
    key: string,
    body: Buffer | Readable | Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    // Lazily make sure the bucket exists before the first write.
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * Retrieve an object's body as a readable stream.
   */
  async getObjectStream(key: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    return result.Body as Readable;
  }

  /**
   * Generate a time-limited presigned GET URL for an object.
   */
  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * Readiness probe for Object_Storage — issues a HeadBucket against the
   * configured bucket. Resolves on success; throws if the bucket is missing or
   * the endpoint/credentials are unreachable. Used by the /health/ready probe.
   */
  async headBucket(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /**
   * Readiness probe used by /health/ready.
   *
   * Readiness means "the object storage endpoint is REACHABLE" — not that the
   * bucket has already been written to. On a fresh deployment the bucket is
   * created lazily on the first upload (see ensureBucket), so a HeadBucket can
   * legitimately return 404 (NoSuchBucket / NotFound) while MinIO itself is
   * perfectly healthy. Treating that as `down` would wedge readiness (and the
   * deploy smoke check that polls it) at 503 forever until the first upload.
   *
   * So: any HTTP response from the server (including 404) means reachable → ok.
   * Only a transport-level failure (endpoint unreachable, DNS, refused
   * connection — no `$metadata.httpStatusCode`) is a real readiness failure and
   * is re-thrown.
   */
  async checkReady(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      // Server responded (e.g. 404 for a missing bucket) → endpoint reachable.
      if (typeof httpStatus === 'number') {
        return;
      }
      // No HTTP response → transport error → storage genuinely down.
      throw err;
    }
  }
}
