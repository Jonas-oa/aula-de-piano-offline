const DB_NAME = "partitura-viva";
const DB_VERSION = 2;
const STORE_NAME = "pieces";
const LOG_STORE_NAME = "logs";
// O log serve para investigar o que acabou de acontecer. Guardar sessão sem fim
// encheria o aparelho do aluno para nada.
const MAX_STORED_LOGS = 20;
// O áudio de diagnóstico é a parte pesada: três minutos comprimidos passam de
// um megabyte, e vinte deles encostariam na cota do navegador — que, ao estourar,
// derruba o repertório junto. Só os cinco mais recentes conservam o som; os
// diários mais antigos continuam inteiros, sem o anexo.
const MAX_STORED_AUDIOS = 5;

// O limite é de áudios, não de sessões. Uma sessão sem gravação não pode
// expulsar o único diagnóstico sonoro existente só por ser mais recente.
export function audioIdsToDiscard(records, maxAudios = MAX_STORED_AUDIOS) {
  const audioRecords = (records || [])
    .filter(({ audioAsset }) => Boolean(audioAsset))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const excess = Math.max(0, audioRecords.length - Math.max(0, Number(maxAudios) || 0));
  return audioRecords.slice(0, excess).map(({ id }) => id);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(LOG_STORE_NAME)) {
        database.createObjectStore(LOG_STORE_NAME, { keyPath: "id" });
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

export async function saveSessionLog(record) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LOG_STORE_NAME, "readwrite");
    const store = transaction.objectStore(LOG_STORE_NAME);
    await requestResult(store.put(record));
    const stored = await requestResult(store.getAll());
    // O `id` é o instante de início em ISO, então a ordem alfabética é a
    // cronológica e as sessões mais antigas saem primeiro.
    const ids = stored.map(({ id }) => id).sort();
    const excess = ids.slice(0, Math.max(0, ids.length - MAX_STORED_LOGS));
    for (const id of excess) await requestResult(store.delete(id));

    // Entre as sessões que ficam, só as mais recentes conservam o áudio. O
    // diário antigo permanece completo: perde o anexo, não as medidas.
    const kept = stored.filter(({ id }) => !excess.includes(id));
    for (const id of audioIdsToDiscard(kept)) {
      const older = kept.find((entry) => entry.id === id);
      if (!older?.audioAsset) continue;
      const { audioAsset, ...withoutAudio } = older;
      await requestResult(store.put({
        ...withoutAudio,
        // Some o som, fica o registro de que existiu e por que não está mais aqui.
        audio: { ...(older.audio || {}), descartado: "espaço" },
      }));
    }
    return record;
  } finally {
    database.close();
  }
}

export async function listSessionLogs() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LOG_STORE_NAME, "readonly");
    const stored = await requestResult(transaction.objectStore(LOG_STORE_NAME).getAll());
    return stored.sort((left, right) => String(right.id).localeCompare(String(left.id)));
  } finally {
    database.close();
  }
}

export async function clearSessionLogs() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(LOG_STORE_NAME, "readwrite");
    await requestResult(transaction.objectStore(LOG_STORE_NAME).clear());
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
