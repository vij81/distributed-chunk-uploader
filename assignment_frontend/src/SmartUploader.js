// import React, { useState, useRef } from "react";
// import axios from "axios";

// const CHUNK_SIZE = 5 * 1024 * 1024;
// const MAX_PARALLEL = 3;

// export default function SmartUploader() {
//   const [file, setFile] = useState(null);
//   const [uploadId, setUploadId] = useState(null);
//   const [uploadedChunks, setUploadedChunks] = useState([]);
//   const [progress, setProgress] = useState(0);
//   const [paused, setPaused] = useState(false);

//   const pausedRef = useRef(false);          // 🔥 instant pause control
//   const queueRef = useRef([]);
//   const activeUploadsRef = useRef(0);

//   async function handleFileSelect(e) {
//     const f = e.target.files[0];
//     setFile(f);

//     const totalChunks = Math.ceil(f.size / CHUNK_SIZE);
//     const fileHash = `${f.name}-${f.size}`;

//     const res = await axios.post("http://localhost:8080/upload/init", {
//       fileHash,
//       filename: f.name,
//       totalSize: f.size,
//       totalChunks
//     });

//     console.log("INIT:", res.data);
//     setUploadId(res.data.uploadId);
//     const already = res.data.uploadedIndexes || [];
//     setUploadedChunks(already);
//     updateProgress(already.length, f);
//   }

//   async function uploadChunks() {
//     if (!file || pausedRef.current) return;

//     const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
//     const missing = [];

//     for (let i = 0; i < totalChunks; i++) {
//       if (!uploadedChunks.includes(i)) missing.push(i);
//     }

//     queueRef.current = missing;
//     console.log("Chunks to upload:", missing);

//     for (let i = 0; i < MAX_PARALLEL; i++) processNext();
//   }

//   async function processNext() {
//     if (pausedRef.current) {
//       console.log("⏸ HARD STOP — pausedRef:true");
//       return;
//     }

//     if (queueRef.current.length === 0) {
//       if (activeUploadsRef.current === 0) finalizeUpload();
//       return;
//     }

//     const index = queueRef.current.shift();
//     activeUploadsRef.current++;
//     console.log("Uploading chunk:", index);

//     const blob = file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
//     const buffer = await blob.arrayBuffer();

//     try {
//       await axios.post("http://localhost:8080/upload/chunk", buffer, {
//         headers: {
//           "Content-Type": "application/octet-stream",
//           "upload-id": uploadId,
//           "chunk-index": index
//         }
//       });

//       setUploadedChunks(prev => {
//         const updated = [...prev, index];
//         updateProgress(updated.length, file);
//         return updated;
//       });

//     } catch {
//       queueRef.current.push(index);

//     } finally {
//       activeUploadsRef.current--;
//       if (!pausedRef.current) processNext();     // 🔥 only continue when NOT paused
//     }
//   }

//   function updateProgress(done, f) {
//     const fileObj = f || file;
//     const total = Math.ceil(fileObj.size / CHUNK_SIZE);
//     setProgress(Math.min(100, Math.round((done / total) * 100)));   // cap at 100
//   }

//   async function finalizeUpload() {
//     const res = await axios.post("http://localhost:8080/upload/finalize", { uploadId });
//     alert(
//       `🚀 Upload Completed!\n\nSHA-256:\n${res.data.hash}\n\nFiles:\n${(res.data.peek || []).join("\n")}`
//     );
//   }

//   return (
//     <div style={{ padding: 25 }}>
//       <h2>📤 Smart Chunk Uploader</h2>
//       <input type="file" onChange={handleFileSelect} />

//       {file && (
//         <>
//           <button onClick={() => { pausedRef.current = false; setPaused(false); uploadChunks(); }}>
//             Start Upload
//           </button>

//           <button onClick={() => {
//             pausedRef.current = true;
//             setPaused(true);
//             console.log("⏸ PAUSED (instant)");
//           }}>
//             Pause
//           </button>

//           <button onClick={() => {
//             pausedRef.current = false;
//             setPaused(false);
//             console.log("▶ RESUMED");
//             processNext();
//           }}>
//             Resume
//           </button>

//           <h3>Progress: {progress}%</h3>
//           <div style={{ width: "100%", height: 12, background: "#ccc" }}>
//             <div style={{
//               width: `${progress}%`,
//               height: "100%",
//               background: "green"
//             }}></div>
//           </div>
//         </>
//       )}
//     </div>
//   );
// }
import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import "./upload.css";

const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_PARALLEL = 3;

export default function SmartUploader() {
  const finalizedRef = useRef(false);
  const uploadedChunksRef = useRef([]);

  const [file, setFile] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [uploadedChunks, setUploadedChunks] = useState([]);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [eta, setEta] = useState(null);

  const pausedRef = useRef(false);
  const queueRef = useRef([]);
  const activeUploadsRef = useRef(0);
  const startTimeRef = useRef(null);
  const totalChunksRef = useRef(0);
  const didRestoreRef = useRef(false);

  // Load previous state if browser refresh
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("upload_state"));
    if (!saved) return;
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;
    setUploadId(saved.uploadId);
    setUploadedChunks(saved.uploadedChunks || []);
    totalChunksRef.current = Math.ceil(saved.size / CHUNK_SIZE);
    alert("⚠ Please re-select the SAME file to continue upload");
  }, []);

  function saveState(uploadId, uploadedChunks, file) {
    localStorage.setItem(
      "upload_state",
      JSON.stringify({
        uploadId,
        uploadedChunks,
        filename: file.name,
        size: file.size,
        type: file.type,
        fileHash: `${file.name}-${file.size}`,
      })
    );
  }

  async function startNewUpload(file) {
    setFile(file);
    startTimeRef.current = Date.now();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    totalChunksRef.current = totalChunks;
    const fileHash = `${file.name}-${file.size}`;
    const saved = JSON.parse(localStorage.getItem("upload_state"));

    const res = await axios.post("http://localhost:8080/upload/init", {
      fileHash,
      filename: file.name,
      totalSize: file.size,
      totalChunks,
      uploadId: saved?.uploadId || null,
    });

    const incomingId = res.data.uploadId;
    setUploadId(incomingId);
    const uploaded = res.data.uploadedIndexes || [];
    uploadedChunksRef.current = uploaded;
    setUploadedChunks(uploaded);
    saveState(incomingId, uploaded, file);
    updateProgress(uploaded.length, file);
  }

  async function handleFileSelect(e) {
    const f = e.target.files[0];
    const saved = JSON.parse(localStorage.getItem("upload_state"));
    const totalChunks = Math.ceil(f.size / CHUNK_SIZE);

    if (saved && saved.filename === f.name && saved.size === f.size) {
      const res = await axios.post("http://localhost:8080/upload/init", {
        fileHash: saved.fileHash,
        filename: f.name,
        totalSize: f.size,
        totalChunks,
        uploadId: saved.uploadId,
      });

      alert("♻ Resuming previous upload…");
      setFile(f);
      setUploadId(res.data.uploadId);
      uploadedChunksRef.current = res.data.uploadedIndexes;
      setUploadedChunks(res.data.uploadedIndexes);
      totalChunksRef.current = totalChunks;
      updateProgress(res.data.uploadedIndexes.length, f);
      saveState(res.data.uploadId, res.data.uploadedIndexes, f);
      return;
    }

    startNewUpload(f);
  }

  async function uploadChunks() {
    if (!file || pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);

    const totalChunks = totalChunksRef.current;
    const missing = [];

    for (let i = 0; i < totalChunks; i++) {
      if (!uploadedChunksRef.current.includes(i)) missing.push(i);
    }

    queueRef.current = missing;
    for (let i = 0; i < MAX_PARALLEL; i++) processNext();
  }

  async function processNext() {
    if (pausedRef.current) return;

    // FINALIZE CHECK
    if (queueRef.current.length === 0 && activeUploadsRef.current === 0) {
      const total = totalChunksRef.current;
      const done = uploadedChunksRef.current.length;
      if (done === total && !finalizedRef.current) {
        console.log("🚀 Finalizing upload…");
        return finalizeUpload();
      }
    }

    const index = queueRef.current.shift();
    if (index === undefined) return;

    activeUploadsRef.current++;

    const blob = file.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
    const buffer = await blob.arrayBuffer();

    try {
      await axios.post("http://localhost:8080/upload/chunk", buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "upload-id": uploadId,
          "chunk-index": index,
        },
      });

      setUploadedChunks((prev) => {
        const updated = [...prev, index];
        uploadedChunksRef.current = updated;
        saveState(uploadId, updated, file);
        updateProgress(updated.length, file);
        return updated;
      });
    } finally {
      activeUploadsRef.current--;
      if (!pausedRef.current) processNext();
    }
  }

  function updateProgress(done, fileObj) {
    const f = fileObj || file;
    if (!f) return;
    const total = Math.ceil(f.size / CHUNK_SIZE);
    const percent = Math.floor((done / total) * 100);
    setProgress(percent);

    if (done === 0) {
      setEta("Starting…");
      return;
    }
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const avg = elapsed / done;
    setEta(Math.max(1, Math.ceil((total - done) * avg)));
  }

  async function finalizeUpload() {
    if (finalizedRef.current) return;
    finalizedRef.current = true;

    setProgress(100);

    try {
      const res = await axios.post(
        "http://localhost:8080/upload/finalize",
        { uploadId }
      );

      const hash =
        res?.data?.hash ??
        res?.data?.final_hash ??
        res?.data?.digest ??
        "(hash missing)";

      console.log("✔ FINAL RESPONSE:", res.data);
      alert(`🎉 Upload Completed!\n\nSHA-256 Hash:\n${hash}`);
    } catch {
      alert("❌ Finalize failed — backend error");
    }

    localStorage.removeItem("upload_state");
  }

  return (
    <div style={{ padding: 25 }}>
      <h2>📤 Smart Chunk Uploader</h2>
      <input type="file" onChange={handleFileSelect} />

      {file && (
        <>
          <button onClick={uploadChunks}>Start</button>
          <button onClick={() => { pausedRef.current = true; setPaused(true); }}>Pause</button>

          <button
            onClick={async () => {
              pausedRef.current = false;
              setPaused(false);
              const saved = JSON.parse(localStorage.getItem("upload_state"));
              if (!saved) return alert("Nothing to resume!");
              const res = await axios.post("http://localhost:8080/upload/init", {
                uploadId: saved.uploadId,
                fileHash: `${file.name}-${file.size}`,
                filename: file.name,
                totalSize: file.size,
                totalChunks: totalChunksRef.current,
              });
              const missing = [];
              for (let i = 0; i < totalChunksRef.current; i++)
                if (!res.data.uploadedIndexes.includes(i)) missing.push(i);
              queueRef.current = missing;
              for (let i = 0; i < MAX_PARALLEL; i++) processNext();
            }}
          >
            Resume
          </button>

          <button onClick={() => { localStorage.removeItem("upload_state"); window.location.reload(); }}>
            Reset
          </button>

          <h3>Progress: {progress}%</h3>
          <div style={{ width: "100%", height: 12, background: "#ccc" }}>
            <div style={{ width: `${progress}%`, height: "100%", background: "green" }}></div>
          </div>

          <h4>ETA: {eta ? `${eta}s` : "Calculating..."}</h4>

          <h4>Chunks</h4>
          <div className="grid">
            {Array.from({ length: totalChunksRef.current }).map((_, i) => (
              <div
                key={i}
                className={
                  uploadedChunks.includes(i)
                    ? "cell success"
                    : paused
                    ? "cell paused"
                    : "cell pending"
                }
              >
                {i}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
