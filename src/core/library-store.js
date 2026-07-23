const DB_NAME = "partitura-viva";
const DB_VERSION = 1;
const STORE_NAME = "pieces";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listPieces() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return await requestResult(transaction.objectStore(STORE_NAME).getAll());
  } finally {
    database.close();
  }
}

export async function savePiece(piece) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).put(piece));
    return piece;
  } finally {
    database.close();
  }
}

export async function deletePiece(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(STORE_NAME).delete(id));
  } finally {
    database.close();
  }
}

export async function fileToStoredAsset(file) {
  if (!file) return null;
  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    bytes: await file.arrayBuffer(),
  };
}

export function storedAssetToBlob(asset) {
  if (!asset) return null;
  return new Blob([asset.bytes], { type: asset.type });
}
