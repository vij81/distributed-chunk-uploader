import fs from "fs";
import { db } from "./db.js";

setInterval(async () => {
  console.log("🧹 Cleanup running...");
  const [rows] = await db.query(
    "SELECT * FROM uploads WHERE status='UPLOADING' AND created_at < NOW() - INTERVAL 1 DAY"
  );

  for (const row of rows) {
    if (fs.existsSync(`uploads_tmp/${row.id}.tmp`))
      fs.unlinkSync(`uploads_tmp/${row.id}.tmp`);
    await db.query("DELETE FROM chunks WHERE upload_id=?", [row.id]);
    await db.query("DELETE FROM uploads WHERE id=?", [row.id]);
  }
}, 1000 * 60 * 30); // every 30 minutes
