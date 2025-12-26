# Chunked File Upload w/ Pause/Resume & Integrity Check

This is a personal solution for a common problem: the need to transfer large files when the networks are not so reliable.

Rather than doing an upload of one kind where an entire file is uploaded at once, this application allows it to be done piece by piece and pause and continue any time. It also tries to find whether the final merged file is indeed the same file by hashing.

## What the Project Does
The project involves translating
- Facilitates the uploading of large files by breaking them down into pieces. (e.g., 1MB pieces.)
- Uploads can be paused and continued later without having to begin the process from start to end.
- If a page reload occurs, it will be remembered which chunks of information are uploaded.

- Afterwards, when the upload process is completed, all chunks are assembled back to a single file by the server.

- To ensure that nothing has been corrupted in transit, a check using a hash in the final file is used.

---
## File Integrity Handling (Hashing)

Uploading a file in chunks means there's also a possibility of:

- a piece may be damaged in transit

– or the consolidated document may fail to correspond with the original
In order to counter this issue, I applied SHA-256 hashing
"Here’s what actually happens:
They
1. Before uploading, the browser computes the SHA-256 hash of the original file.

2. Hash values are sent to a server.

3. The server then also calculates its SHA-256 hash of the merged result once all the chunks are uploaded and merged.

4. If the two hashes are a match → the upload is valid.

5. If they don't match → delete file and return an error to user.

"The hash basically functions much like a fingerprint; if a single byte is incorrect, it will change the fingerprint."
---
## The Mechanism of Pause \& Resume
The browser uploads each chunk separately.

In each of these upload steps, there is just one condition checked: Is Uploading or Paused?.

- When you press the button labeled "Pause," it won't cancel anything; it merely stops the sending of the next piece.

- When you click Resume, the browser asks the server for:

“Which chunks do you already have?”

- The server returns the numbers of the chunks already uploaded.
- Then, the browser start sending only the lacking pieces.
With this approach, nothing is ever uploaded twice, and your progress will never be lost except when the server itself is being restarted.
---
## Trade-Offs & Limitations

When constructing it, I made a couple of decisions to keep things simple:

| Trade-off | Reason for making that choice | |---------- | Serial uploading of chunks instead of being done in parallel | Easily controlled pause/resume functionality, easy debugging | | There was no permanent database system for chunk tracking | A JSON object w/ filesystem checks sufficed for a demo | If hashing occurs only prior to and subsequent to the file upload process
| Continuously checking the hash each chunk would slow the process
Hashing takes place only prior to and subsequent to the upload of | State is not stored in the browser | Has room for improvement with Indexed DB for offline resume-ability | Basically, this is an effective system on one server and for private usage. It would require redistributed or cloud storage and parallel upload capabilities for faster execution if implemented for production.
