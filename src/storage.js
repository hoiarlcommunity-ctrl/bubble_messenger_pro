const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const config = require('./config');

let s3Client = null;

function isS3Enabled() {
  return String(config.storageDriver).toLowerCase() === 's3';
}

function getS3() {
  if (!isS3Enabled()) return null;
  if (s3Client) return s3Client;
  s3Client = new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: {
      accessKeyId: config.s3AccessKey,
      secretAccessKey: config.s3SecretKey
    }
  });
  return s3Client;
}

function parseS3Path(storagePath) {
  const value = String(storagePath || '');
  if (value.startsWith('s3://')) {
    const rest = value.slice('s3://'.length);
    const slash = rest.indexOf('/');
    return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
  }
  return { bucket: config.s3Bucket, key: value };
}

function normalizeKey(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '');
}

async function saveUploadedFile(file, { ownerId, kind = 'file' } = {}) {
  if (!file) throw new Error('file_required');
  if (!isS3Enabled()) {
    return {
      filename: file.filename,
      storagePath: file.path,
      sizeBytes: file.size
    };
  }

  const key = normalizeKey(`${config.s3Prefix}/${ownerId || 'anonymous'}/${Date.now()}-${file.filename}`);
  const s3 = getS3();
  await s3.send(new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    Body: fs.createReadStream(file.path),
    ContentType: file.mimetype,
    Metadata: {
      originalName: Buffer.from(file.originalname || '').toString('base64').slice(0, 512),
      kind: String(kind || 'file')
    }
  }));
  await fs.promises.unlink(file.path).catch(() => {});
  return {
    filename: path.basename(key),
    storagePath: `s3://${config.s3Bucket}/${key}`,
    sizeBytes: file.size
  };
}

async function deleteStoredFile(storagePath) {
  if (!storagePath) return;
  if (!String(storagePath).startsWith('s3://')) {
    await fs.promises.unlink(storagePath).catch(() => {});
    return;
  }
  const { bucket, key } = parseS3Path(storagePath);
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
}

async function sendStoredFile(media, res) {
  if (!media?.storage_path) throw new Error('file_missing');
  if (!String(media.storage_path).startsWith('s3://')) {
    if (!fs.existsSync(media.storage_path)) {
      const err = new Error('file_missing');
      err.statusCode = 404;
      throw err;
    }
    res.setHeader('Content-Type', media.mime_type);
    res.setHeader('Content-Length', media.size_bytes);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(path.resolve(media.storage_path));
  }

  const { bucket, key } = parseS3Path(media.storage_path);
  const object = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  res.setHeader('Content-Type', media.mime_type || object.ContentType || 'application/octet-stream');
  if (media.size_bytes) res.setHeader('Content-Length', media.size_bytes);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  object.Body.pipe(res);
}

module.exports = { isS3Enabled, saveUploadedFile, deleteStoredFile, sendStoredFile };
