import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientLogoObjectKey,
  buildInventoryImageObjectKey,
  hasExpectedImageSignature,
  inventoryImageUploadError,
  isSameOriginRequest,
  MAX_INVENTORY_IMAGE_BYTES,
  parseClientLogoIntent,
  parseInventoryImageIntent,
} from '../src/lib/inventory-images/core.ts';

const ids = {
  clientId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  productId: '33333333-3333-4333-8333-333333333333',
  imageId: '44444444-4444-4444-8444-444444444444',
};
const validIntent = () => ({
  productId: ids.productId,
  branchId: ids.branchId,
  contentType: 'image/webp',
  byteSize: 1024,
  checksumSha256: `${'A'.repeat(43)}=`,
});

test('a valid upload intent preserves only bounded image metadata', () => {
  assert.deepEqual(parseInventoryImageIntent(validIntent()), validIntent());
});

test('SVG and arbitrary upload content types fail closed', () => {
  for (const contentType of ['image/svg+xml', 'text/html', 'IMAGE/PNG', '', null]) {
    assert.throws(() => parseInventoryImageIntent({ ...validIntent(), contentType }), /INVALID_IMAGE_TYPE/);
  }
});

test('empty, oversized, fractional, and non-numeric sizes fail closed', () => {
  for (const byteSize of [0, MAX_INVENTORY_IMAGE_BYTES + 1, 1.5, '1024', Infinity]) {
    assert.throws(() => parseInventoryImageIntent({ ...validIntent(), byteSize }), /INVALID_IMAGE_SIZE/);
  }
});

test('owner identifiers, checksums, and unexpected tenant fields are validated', () => {
  assert.throws(() => parseInventoryImageIntent({ ...validIntent(), branchId: '../other' }), /INVALID_IMAGE_OWNER/);
  assert.throws(() => parseInventoryImageIntent({ ...validIntent(), checksumSha256: 'not-a-checksum' }), /INVALID_IMAGE_CHECKSUM/);
  assert.throws(() => parseInventoryImageIntent({ ...validIntent(), clientId: ids.clientId }), /UNEXPECTED_IMAGE_FIELD/);
  assert.throws(() => parseInventoryImageIntent({ ...validIntent(), filename: '../../payload.svg' }), /UNEXPECTED_IMAGE_FIELD/);
});

test('object keys are deterministic, tenant-scoped, and do not use client filenames', () => {
  assert.equal(
    buildInventoryImageObjectKey({ ...ids, contentType: 'image/jpeg' }),
    `clients/${ids.clientId}/branches/${ids.branchId}/products/${ids.productId}/${ids.imageId}.jpg`,
  );
  assert.equal(
    buildInventoryImageObjectKey({ ...ids, contentType: 'image/png' }).endsWith('.png'),
    true,
  );
  assert.equal(
    buildInventoryImageObjectKey({ ...ids, contentType: 'image/webp' }).endsWith('.webp'),
    true,
  );
});

test('client logo intent accepts image metadata but rejects tenant-controlled ownership', () => {
  const logoIntent = {
    contentType: 'image/png',
    byteSize: 2048,
    checksumSha256: `${'B'.repeat(43)}=`,
  };
  assert.deepEqual(parseClientLogoIntent(logoIntent), logoIntent);
  assert.throws(
    () => parseClientLogoIntent({ ...logoIntent, clientId: ids.clientId }),
    /UNEXPECTED_IMAGE_FIELD/,
  );
  assert.throws(
    () => parseClientLogoIntent({ ...logoIntent, contentType: 'image/svg+xml' }),
    /INVALID_IMAGE_TYPE/,
  );
});

test('client logo keys stay inside the authenticated client branding prefix', () => {
  assert.equal(
    buildClientLogoObjectKey({
      clientId: ids.clientId,
      imageId: ids.imageId,
      contentType: 'image/webp',
    }),
    `clients/${ids.clientId}/branding/${ids.imageId}.webp`,
  );
  assert.throws(
    () => buildClientLogoObjectKey({
      clientId: '../another-client',
      imageId: ids.imageId,
      contentType: 'image/png',
    }),
    /INVALID_IMAGE_KEY_ID/,
  );
});

test('JPEG, PNG, and WebP magic bytes must match the declared type', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(hasExpectedImageSignature('image/jpeg', jpeg), true);
  assert.equal(hasExpectedImageSignature('image/png', png), true);
  assert.equal(hasExpectedImageSignature('image/webp', webp), true);
  assert.equal(hasExpectedImageSignature('image/png', jpeg), false);
  assert.equal(hasExpectedImageSignature('image/webp', Uint8Array.from([1, 2, 3])), false);
});

test('mutation origin comparison requires an exact origin match', () => {
  assert.equal(isSameOriginRequest('http://127.0.0.1:3000/api/test', 'http://127.0.0.1:3000'), true);
  assert.equal(isSameOriginRequest(
    'http://localhost:3000/api/test',
    'http://127.0.0.1:3000',
    '127.0.0.1:3000',
    'http',
  ), true);
  assert.equal(isSameOriginRequest('https://ezpztek.com/api/test', 'https://ezpztek.com'), true);
  assert.equal(isSameOriginRequest('https://ezpztek.com/api/test', 'https://evil-ezpztek.com'), false);
  assert.equal(isSameOriginRequest(
    'https://ezpztek.com/api/test',
    'https://evil.example',
    'ezpztek.com',
    'https',
  ), false);
  assert.equal(isSameOriginRequest('https://ezpztek.com/api/test', null), false);
});

test('S3 upload failures expose only a safe status and error code', () => {
  assert.equal(
    inventoryImageUploadError(403, '<Error><Code>AccessDenied</Code><Message>secret detail</Message></Error>'),
    'AWS denied permission to save the image. Check the role and bucket policies. (AWS 403: AccessDenied)',
  );
  assert.equal(
    inventoryImageUploadError(400, '<Error><Code>AuthorizationHeaderMalformed</Code></Error>'),
    'The AWS upload was signed for the wrong region. (AWS 400: AuthorizationHeaderMalformed)',
  );
  assert.equal(
    inventoryImageUploadError(500, '<html>not XML</html>'),
    'AWS rejected the image upload (HTTP 500). Check the S3 CORS, IAM, and bucket policies.',
  );
});
