import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import {
  hasExpectedImageSignature,
  type InventoryImageContentType,
} from "@/lib/inventory-images/core";

const IMAGE_CACHE_CONTROL = "private, max-age=31536000, immutable";
const PRESIGNED_UPLOAD_SECONDS = 5 * 60;
const PRESIGNED_READ_SECONDS = 5 * 60;

type StoredImage = {
  id: string;
  objectKey: string;
  contentType: InventoryImageContentType;
  byteSize: number;
  checksumSha256: string;
};

let cachedClient: S3Client | undefined;
let cachedIdentity = "";

function storageConfiguration() {
  const region = process.env.AWS_REGION?.trim() || "ap-southeast-2";
  const bucket = process.env.AWS_S3_INVENTORY_BUCKET?.trim();
  const roleArn = process.env.AWS_ROLE_ARN?.trim();
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("S3_IMAGE_STORAGE_NOT_CONFIGURED");
  }
  return { region, bucket, roleArn };
}

function imageS3Client() {
  const configuration = storageConfiguration();
  const identity = `${configuration.region}:${configuration.roleArn || "default"}`;
  if (!cachedClient || cachedIdentity !== identity) {
    cachedIdentity = identity;
    cachedClient = new S3Client({
      region: configuration.region,
      credentials: configuration.roleArn
        ? awsCredentialsProvider({
            roleArn: configuration.roleArn,
            roleSessionName: "ezpztek-inventory-images",
            clientConfig: { region: configuration.region },
          })
        : undefined,
    });
  }
  return { client: cachedClient, ...configuration };
}

export function assertInventoryImageStorageConfigured() {
  storageConfiguration();
}

export function isInventoryImageStorageConfigured() {
  try {
    storageConfiguration();
    return true;
  } catch {
    return false;
  }
}

export async function createInventoryImageUpload(
  image: StoredImage,
) {
  const { client, bucket } = imageS3Client();
  const fields = {
    "Content-Type": image.contentType,
    "Cache-Control": IMAGE_CACHE_CONTROL,
    "x-amz-checksum-algorithm": "SHA256",
    "x-amz-checksum-sha256": image.checksumSha256,
    "x-amz-meta-image-id": image.id,
    "x-amz-server-side-encryption": "AES256",
  };
  return createPresignedPost(client, {
    Bucket: bucket,
    Key: image.objectKey,
    Expires: PRESIGNED_UPLOAD_SECONDS,
    Fields: fields,
    Conditions: [
      ["content-length-range", image.byteSize, image.byteSize],
      { "Content-Type": image.contentType },
      { "Cache-Control": IMAGE_CACHE_CONTROL },
      { "x-amz-checksum-algorithm": "SHA256" },
      { "x-amz-checksum-sha256": image.checksumSha256 },
      { "x-amz-meta-image-id": image.id },
      { "x-amz-server-side-encryption": "AES256" },
    ],
  });
}

export async function verifyInventoryImageUpload(image: StoredImage) {
  const { client, bucket } = imageS3Client();
  const head = await client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: image.objectKey,
    ChecksumMode: "ENABLED",
  }));
  const storedContentType = head.ContentType?.split(";")[0].trim().toLowerCase();
  if (
    head.ContentLength !== image.byteSize ||
    storedContentType !== image.contentType ||
    head.ChecksumSHA256 !== image.checksumSha256 ||
    head.Metadata?.["image-id"] !== image.id ||
    head.ServerSideEncryption !== "AES256"
  ) {
    throw new Error("S3_IMAGE_METADATA_MISMATCH");
  }

  const object = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: image.objectKey,
    Range: "bytes=0-15",
  }));
  const header = object.Body ? await object.Body.transformToByteArray() : new Uint8Array();
  if (!hasExpectedImageSignature(image.contentType, header)) {
    throw new Error("S3_IMAGE_SIGNATURE_MISMATCH");
  }
  if (!head.ETag) throw new Error("S3_IMAGE_ETAG_MISSING");
  if (!head.LastModified) throw new Error("S3_IMAGE_LAST_MODIFIED_MISSING");
  return { etag: head.ETag, uploadedAt: head.LastModified };
}

export async function inventoryImageReadUrl(objectKey: string) {
  const { client, bucket } = imageS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    { expiresIn: PRESIGNED_READ_SECONDS },
  );
}

export async function deleteInventoryImageObject(objectKey: string) {
  const { client, bucket } = imageS3Client();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}
