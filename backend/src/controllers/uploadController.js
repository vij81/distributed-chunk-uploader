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

  if (!uploadId) return res.status(400).json({ error: "Missing uploadId" });

  const tmp = `uploads_tmp/${uploadId}.tmp`;
  const finalPath = `uploads_final/${uploadId}.zip`;

  // 1️⃣ Validate existing row
  const [[row]] = await db.query("SELECT * FROM uploads WHERE id=?", [uploadId]);
  if (!row) return res.status(404).json({ error: "Upload not found" });

  // 2️⃣ Avoid duplicate finalize
  if (row.status === "COMPLETED") return sendPeek(finalPath, row.final_hash, res);

  // 3️⃣ Ensure tmp file actually exists
  if (!fs.existsSync(tmp)) {
    await db.query("UPDATE uploads SET status='ERROR' WHERE id=?", [uploadId]);
    return res.status(500).json({ error: "Upload incomplete – missing chunk tmp file" });
  }

  // 4️⃣ Ensure final directory exists
  if (!fs.existsSync("uploads_final")) fs.mkdirSync("uploads_final");

  // 5️⃣ Rename atomically inside try–catch
  try {
    fs.renameSync(tmp, finalPath);
  } catch (err) {
    console.error("❌ Rename failed:", err);
    return res.status(500).json({ error: "Failed to finalize file" });
  }

  // 6️⃣ Hash safely
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(finalPath);

  stream.on("error", async (err) => {
    console.error("❌ Hash read error:", err);
    await db.query("UPDATE uploads SET status='ERROR' WHERE id=?", [uploadId]);
    return res.status(500).json({ error: "File hashing failed" });
  });

  stream.on("data", d => hash.update(d));

  stream.on("end", async () => {
    const digest = hash.digest("hex");

    await db.query(
      "UPDATE uploads SET status='COMPLETED', final_hash=? WHERE id=?",
      [digest, uploadId]
    );

    return sendPeek(finalPath, digest, res);
  });
}
function sendPeek(zipPath, hash, res) {
  const names = [];

  if (!zipPath || !fs.existsSync(zipPath)) {
    return res.json({ hash, peek: [] });
  }

  yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
    if (err || !zip) {
      return res.json({ hash, peek: [] });
    }

    zip.readEntry();
    zip.on("entry", e => {
      names.push(e.fileName);
      zip.readEntry();
    });

    zip.on("end", () => {
      return res.json({ hash, peek: names });
    });

    zip.on("error", () => {
      return res.json({ hash, peek: [] });
    });
  });
}
