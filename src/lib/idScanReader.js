// Reads the words off a photo ID on the desk's own device (Tesseract in the
// browser). The photo is never sent anywhere for this. The reader files are
// served from /ocr on our own site and load only when Scan is first used.

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import("tesseract.js").then(({ createWorker }) =>
      createWorker("eng", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr",
        langPath: "/ocr",
        gzip: true,
      })
    );
    // A failed load must be retried next time, not remembered.
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** A big photo is shrunk and turned grey first: faster, and Tesseract reads it better. */
async function prepare(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.3)";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas;
}

/** The text found on one photo. */
export async function readPhotoText(file) {
  const worker = await getWorker();
  const image = await prepare(file);
  const { data } = await worker.recognize(image);
  return data.text || "";
}
