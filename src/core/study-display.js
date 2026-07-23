export function requestStudyDisplay({
  documentRef = globalThis.document,
  screenRef = globalThis.screen,
} = {}) {
  const root = documentRef?.documentElement;
  let fullscreenRequest;

  try {
    fullscreenRequest = documentRef?.fullscreenElement
      ? Promise.resolve(true)
      : Promise.resolve(root?.requestFullscreen?.({ navigationUI: "hide" }))
        .then(() => Boolean(documentRef?.fullscreenElement))
        .catch(() => false);
  } catch {
    fullscreenRequest = Promise.resolve(false);
  }

  return fullscreenRequest.then(async (fullscreen) => {
    let landscape = false;
    try {
      if (screenRef?.orientation?.lock) {
        await screenRef.orientation.lock("landscape");
        landscape = true;
      }
    } catch {
      // Alguns navegadores só respeitam a orientação do manifesto/PWA.
    }
    return { fullscreen, landscape };
  });
}

export async function exitStudyDisplay({
  documentRef = globalThis.document,
  screenRef = globalThis.screen,
} = {}) {
  try {
    screenRef?.orientation?.unlock?.();
  } catch {
    // Desbloqueio não é oferecido em todos os navegadores.
  }
  try {
    if (documentRef?.fullscreenElement) await documentRef.exitFullscreen();
  } catch {
    // O usuário pode já ter encerrado a tela cheia pelo sistema.
  }
}

export function isLandscape({
  screenRef = globalThis.screen,
  windowRef = globalThis.window,
} = {}) {
  const type = screenRef?.orientation?.type;
  if (type) return type.startsWith("landscape");
  return Number(windowRef?.innerWidth || 0) > Number(windowRef?.innerHeight || 0);
}
