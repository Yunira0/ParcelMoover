import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_ADMIN_DOCUMENT_BYTES,
  adminDocumentSizeError,
  adminSaveErrorMessage,
  formatAdminFileSize,
} from '../src/utils/adminUpload.ts';

test('matches the existing multipart parser at the 5 MB boundary', () => {
  assert.equal(MAX_ADMIN_DOCUMENT_BYTES, 5 * 1024 * 1024);
  assert.equal(adminDocumentSizeError({ name: 'below-limit.pdf', size: MAX_ADMIN_DOCUMENT_BYTES - 1 }), undefined);
  assert.match(adminDocumentSizeError({ name: 'at-limit.pdf', size: MAX_ADMIN_DOCUMENT_BYTES }), /at-limit\.pdf.*Maximum allowed is 5 MB/);
  assert.match(adminDocumentSizeError({ name: 'too-big.pdf', size: MAX_ADMIN_DOCUMENT_BYTES + 1 }), /too-big\.pdf.*5\.1 MB.*Maximum allowed is 5 MB/);
});

test('names the original oversized PDF and tells the user how to recover', () => {
  assert.match(adminDocumentSizeError({ name: 'Rukmini Bhattarai.pdf', size: 9331278 }), /Rukmini Bhattarai\.pdf is 8\.9 MB.*Compress the file or choose a smaller one/);
  assert.equal(formatAdminFileSize(11881), '12 KB');
});

test('handles an HTML proxy rejection using HTTP status', () => {
  const message = adminSaveErrorMessage({ response: { status: 413, data: '<html>413</html>' } }, 'fallback');
  assert.match(message, /combined upload is too large/);
  assert.match(message, /Each file must be 5 MB or smaller/);
  assert.doesNotMatch(message, /<html>|fallback/);
});

test('handles a JSON proxy rejection using the same recovery', () => {
  assert.match(adminSaveErrorMessage({ response: { status: 413, data: { message: 'Request Entity Too Large' } } }, 'fallback'), /combined upload is too large/);
});

test('distinguishes timeouts and connection failures without promising the write failed', () => {
  for (const code of ['ECONNABORTED', 'ETIMEDOUT']) {
    assert.match(adminSaveErrorMessage({ code }, 'fallback'), /timed out.*Check the admin list before retrying/);
  }
  assert.match(adminSaveErrorMessage({ response: { status: 504 } }, 'fallback'), /timed out/);
  assert.match(adminSaveErrorMessage({ code: 'ERR_NETWORK' }, 'fallback'), /connection failed.*entries are still here/);
});

test('retains specific API errors and handles unstructured server failures', () => {
  assert.equal(adminSaveErrorMessage({ response: { status: 409, data: { message: 'Email or phone number already exists' } } }, 'fallback'), 'Email or phone number already exists');
  assert.match(adminSaveErrorMessage({ response: { status: 502, data: '<html>Bad Gateway</html>' } }, 'fallback'), /server is temporarily unavailable/);
  assert.equal(adminSaveErrorMessage(null, 'fallback'), 'fallback');
});
