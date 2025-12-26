import { db } from "../db.js";
import fs from "fs";
import crypto from "crypto";
import yauzl from "yauzl";

const CHUNK_SIZE = 5 * 1024 * 1024;

// INIT — resume-aware
export async function initUpload(req, res) {
  const { fileHash, filename, totalSize, totalChunks, uploadId } = req.body;

  // 1️⃣ Resume using provided uploadId
  if (uploadId) {
    const [rows] = await db.query("SELECT * FROM uploads WHERE id=?", [uploadId]);
    const row = rows[0];

    if (row && row.status === "COMPLETED") {
      const finalZip = `uploads_final/${uploadId}.zip`;
      if (fs.existsSync(finalZip)) {
        return res.json({
          status: "COMPLETED",
          uploadId,
          uploadedIndexes: [],
          finalHash: row.final_hash
        });
      }
      await db.query("UPDATE uploads SET status='UPLOADING' WHERE id=?", [uploadId]);
    }

    const [chunks] = await db.query(
      "SELECT chunk_index FROM chunks WHERE upload_id=?",
      [uploadId]
    );

    return res.json({
      status: "UPLOADING",
      uploadId,
      uploadedIndexes: chunks.map(c => c.chunk_index)
    });
  }

  // 2️⃣ Lookup existing by hash
  const [existing] = await db.query("SELECT * FROM uploads WHERE file_hash=?", [fileHash]);

  let newUploadId;

  if (existing.length === 0) {
    await db.query(
      "INSERT INTO uploads (file_hash, filename, total_size, total_chunks, status) VALUES (?,?,?,?,?)",
      [fileHash, filename, totalSize, totalChunks, "UPLOADING"]
    );
    const [[row]] = await db.query("SELECT * FROM uploads WHERE file_hash=?", [fileHash]);
    newUploadId = row.id;
  } else {
    const row = existing[0];
    newUploadId = row.id;

    if (row.status === "COMPLETED") {
      const zipPath = `uploads_final/${row.id}.zip`;
      if (fs.existsSync(zipPath)) {
        return res.json({
          status: "COMPLETED",
          uploadId: newUploadId,
          uploadedIndexes: [],
          finalHash: row.final_hash
        });
      }
      await db.query("UPDATE uploads SET status='UPLOADING' WHERE id=?", [newUploadId]);
    }
  }

  const [chunkRows] = await db.query(
    "SELECT chunk_index FROM chunks WHERE upload_id=?",
    [newUploadId]
  );

  res.json({
    status: "UPLOADING",
    uploadId: newUploadId,
    uploadedIndexes: chunkRows.map(r => r.chunk_index)
  });
}

// CHUNK — idempotent write
export async function uploadChunk(req, res) {
  const uploadId = req.headers["upload-id"];
  const chunkIndex = req.headers["chunk-index"];

  if (!uploadId) return res.status(400).json({ error: "Missing upload-id" });

  const tmp = "uploads_tmp";
  const tmpFile = `${tmp}/${uploadId}.tmp`;

  if (!fs.existsSync(tmp)) fs.mkdirSync(tmp);
  if (!fs.existsSync(tmpFile)) fs.writeFileSync(tmpFile, Buffer.alloc(0));

  const writeStream = fs.createWriteStream(tmpFile, {
    flags: "r+",
    start: Number(chunkIndex) * CHUNK_SIZE
  });

  req.pipe(writeStream);

  writeStream.on("finish", async () => {
    await db.query(
      "INSERT IGNORE INTO chunks (upload_id, chunk_index) VALUES (?,?)",
      [uploadId, chunkIndex]
    );
    res.json({ status: "ok" });
  });
}

// RESET — allow restart
export async function resetUpload(req, res) {
  const { uploadId } = req.body;

  await db.query("DELETE FROM chunks WHERE upload_id=?", [uploadId]);
  await db.query("DELETE FROM uploads WHERE id=?", [uploadId]);

  if (fs.existsSync(`uploads_tmp/${uploadId}.tmp`))
    fs.unlinkSync(`uploads_tmp/${uploadId}.tmp`);
  if (fs.existsSync(`uploads_final/${uploadId}.zip`))
    fs.unlinkSync(`uploads_final/${uploadId}.zip`);

  res.json({ ok: true });
}

// FINAL — atomic finalize: prevents double finalize
export async function finalizeUpload(req, res) {
  const { uploadId } = req.body;

  const tmp = `uploads_tmp/${uploadId}.tmp`;
  const finalPath = `uploads_final/${uploadId}.zip`;

  const [[row]] = await db.query("SELECT * FROM uploads WHERE id=?", [uploadId]);

  if (row.status === "COMPLETED") return sendPeek(finalPath, row.final_hash, res);

  await db.query("UPDATE uploads SET status='PROCESSING' WHERE id=?", [uploadId]);

  fs.renameSync(tmp, finalPath);

  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(finalPath);
  stream.on("data", d => hash.update(d));
  stream.on("end", async () => {
    const digest = hash.digest("hex");
    await db.query("UPDATE uploads SET status='COMPLETED', final_hash=? WHERE id=?", [
      digest,
      uploadId
    ]);
    return sendPeek(finalPath, digest, res);
  });
}

// helper — ZIP peek
function sendPeek(zipPath, hash, res) {
  const names = [];

  // If file is missing or cannot open → return safe fallback
  if (!fs.existsSync(zipPath)) {
    return res.json({ hash, peek: [] });
  }

  yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
    if (err || !zip) {
      return res.json({ hash, peek: [] });       // 🛑 avoid undefined
    }

    zip.readEntry();
    zip.on("entry", e => {
      names.push(e.fileName);
      zip.readEntry();
    });

    zip.on("end", () => {
      res.json({
        hash,
        peek: names.length > 0 ? names : []      // 🟢 guaranteed array
      });
    });
  });
}

