const FOCUS_STYLE_ID = 'practice-focus-styles';

const focusStyles = `
.practice-header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}.focus-mode-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap}.focus-mode-button>span:first-child{font-size:1.05rem}.focus-mode-bar,.focus-backdrop{display:none}.focus-mode-bar{align-items:center;gap:8px}.focus-live-status{display:flex;align-items:center;gap:10px;min-height:42px;padding:7px 12px;border:1px solid rgba(217,224,232,.9);border-radius:999px;background:rgba(255,255,255,.94);box-shadow:0 8px 22px rgba(16,36,63,.12);backdrop-filter:blur(14px)}.focus-live-status span{color:var(--muted);font-size:.72rem;font-weight:700;white-space:nowrap}.focus-live-status strong{margin-left:3px;color:var(--primary);font-size:.88rem}.focus-chip{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:8px 12px;border:1px solid rgba(217,224,232,.9);border-radius:999px;background:rgba(255,255,255,.94);color:var(--primary);font-weight:850;box-shadow:0 8px 22px rgba(16,36,63,.12);backdrop-filter:blur(14px)}.focus-chip-primary{background:var(--primary);color:#fff;border-color:var(--primary)}.focus-backdrop{position:fixed;inset:0;z-index:60;width:100%;height:100%;border:0;background:rgba(8,15,27,.42)}body.practice-focus{overflow:hidden;background:#e9edf2}body.practice-focus .app-shell{min-height:100dvh;padding-bottom:0}body.practice-focus .topbar,body.practice-focus .bottom-nav,body.practice-focus .practice-header{display:none}body.practice-focus main{width:100%;height:100dvh;margin:0;padding:0}body.practice-focus #practiceView.active{position:relative;display:grid;grid-template-rows:minmax(0,1fr) clamp(155px,34dvh,285px);gap:8px;width:100%;height:100dvh;padding:max(8px,env(safe-area-inset-top)) max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));animation:none}body.practice-focus .focus-mode-bar{position:fixed;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));z-index:70;display:flex}body.practice-focus .practice-layout{display:block;min-height:0}body.practice-focus .score-card{display:flex;flex-direction:column;height:100%;min-height:0;padding:8px;border-radius:15px}body.practice-focus .score-toolbar{grid-template-columns:auto minmax(90px,1fr);min-height:42px;padding-right:340px}body.practice-focus #toggleNoteNames{display:none}body.practice-focus .score-canvas{flex:1;min-height:0;margin-top:2px}body.practice-focus .score-canvas svg{height:100%;min-height:0;max-height:100%}body.practice-focus .target-note-panel{display:none}body.practice-focus .coach-card{display:none}body.practice-focus.focus-controls-open .focus-backdrop{display:block}body.practice-focus.focus-controls-open .coach-card{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));left:auto;z-index:65;display:block;width:min(420px,calc(100% - 24px));max-height:min(76dvh,650px);overflow:auto;box-shadow:0 24px 70px rgba(8,15,27,.34)}body.practice-focus .keyboard-section{display:flex;flex-direction:column;min-height:0;margin:0}body.practice-focus .keyboard-section .section-heading{display:none}body.practice-focus .piano-keyboard{flex:1;height:auto;min-height:0;padding:7px;border-radius:15px}body.practice-focus .piano-key{flex-basis:clamp(48px,6vw,78px);height:calc(100% - 14px)}body.practice-focus .piano-key.black{flex-basis:clamp(32px,4.1vw,52px);height:62%;margin-right:calc(clamp(16px,2.05vw,26px) * -1);margin-left:calc(clamp(16px,2.05vw,26px) * -1)}body.practice-focus .toast{bottom:max(14px,env(safe-area-inset-bottom))}@media(max-width:640px){.practice-header{grid-template-columns:auto 1fr}.practice-header-actions{grid-column:2;justify-self:start;flex-wrap:wrap}.practice-header-actions .tempo-box{display:flex;gap:8px;align-items:center}.practice-header-actions .tempo-box span,.practice-header-actions .tempo-box strong{display:inline}body.practice-focus #practiceView.active{grid-template-rows:minmax(0,1fr) clamp(160px,38dvh,240px)}body.practice-focus .score-toolbar{padding-right:126px}body.practice-focus .focus-live-status{display:none}body.practice-focus .focus-button-label{display:none}body.practice-focus .focus-chip{width:44px;padding:0}body.practice-focus.focus-controls-open .coach-card{right:10px;bottom:10px;left:10px;width:auto}}
`;

function createButton(id, className, icon, label) {
  const button = document.createElement('button');
  button.id = id;
  button.type = 'button';
  button.className = className;
  button.innerHTML = `<span aria-hidden="true">${icon}</span><span class="focus-button-label">${label}</span>`;
  return button;
}

function initializeFocusMode() {
  const practiceView = document.getElementById('practiceView');
  const practiceHeader = practiceView?.querySelector('.practice-header');
  const practiceLayout = practiceView?.querySelector('.practice-layout');
  const coach = practiceView?.querySelector('.coach-card');
  const tempoBox = practiceHeader?.querySelector('.tempo-box');
  if (!practiceView || !practiceHeader || !practiceLayout || !coach || !tempoBox) return;
  if (document.getElementById('focusModeButton')) return;

  if (!document.getElementById(FOCUS_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = FOCUS_STYLE_ID;
    style.textContent = focusStyles;
    document.head.append(style);
  }

  coach.id = coach.id || 'practiceCoach';

  const headerActions = document.createElement('div');
  headerActions.className = 'practice-header-actions';
  tempoBox.replaceWith(headerActions);
  headerActions.append(tempoBox);

  const focusModeButton = createButton('focusModeButton', 'ghost-button focus-mode-button', '⛶', 'Modo foco');
  focusModeButton.setAttribute('aria-pressed', 'false');
  headerActions.append(focusModeButton);

  const focusBar = document.createElement('div');
  focusBar.id = 'focusModeBar';
  focusBar.className = 'focus-mode-bar';
  focusBar.setAttribute('aria-label', 'Controles do modo foco');
  focusBar.innerHTML = `
    <div class="focus-live-status" aria-live="polite">
      <span>Alvo <strong id="focusTargetNote">Dó 4</strong></span>
      <span>Detectado <strong id="focusDetectedNote">—</strong></span>
    </div>
  `;

  const focusControlsButton = createButton('focusControlsButton', 'focus-chip', '⚙', 'Controles');
  focusControlsButton.setAttribute('aria-expanded', 'false');
  focusControlsButton.setAttribute('aria-controls', coach.id);
  const exitFocusButton = createButton('exitFocusButton', 'focus-chip focus-chip-primary', '✕', 'Sair');
  focusBar.append(focusControlsButton, exitFocusButton);

  const backdrop = document.createElement('button');
  backdrop.id = 'focusBackdrop';
  backdrop.type = 'button';
  backdrop.className = 'focus-backdrop';
  backdrop.setAttribute('aria-label', 'Fechar controles');
  practiceLayout.before(focusBar, backdrop);

  const targetNote = document.getElementById('targetNote');
  const detectedNote = document.getElementById('detectedNote');
  const focusTargetNote = document.getElementById('focusTargetNote');
  const focusDetectedNote = document.getElementById('focusDetectedNote');

  const syncStatus = () => {
    focusTargetNote.textContent = targetNote?.textContent || '—';
    focusDetectedNote.textContent = detectedNote?.textContent || '—';
  };

  const closeControls = () => {
    document.body.classList.remove('focus-controls-open');
    focusControlsButton.setAttribute('aria-expanded', 'false');
  };

  const setFocus = (enabled) => {
    const active = Boolean(enabled) && practiceView.classList.contains('active');
    document.body.classList.toggle('practice-focus', active);
    closeControls();
    focusModeButton.setAttribute('aria-pressed', String(active));
    const label = focusModeButton.querySelector('.focus-button-label');
    if (label) label.textContent = active ? 'Sair do foco' : 'Modo foco';
    if (active) {
      syncStatus();
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  };

  focusModeButton.addEventListener('click', () => setFocus(!document.body.classList.contains('practice-focus')));
  exitFocusButton.addEventListener('click', () => setFocus(false));
  focusControlsButton.addEventListener('click', () => {
    const open = !document.body.classList.contains('focus-controls-open');
    document.body.classList.toggle('focus-controls-open', open);
    focusControlsButton.setAttribute('aria-expanded', String(open));
    if (open) coach.querySelector('button')?.focus();
  });
  backdrop.addEventListener('click', closeControls);

  document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => setFocus(false)));
  document.getElementById('backToHome')?.addEventListener('click', () => setFocus(false));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !document.body.classList.contains('practice-focus')) return;
    if (document.body.classList.contains('focus-controls-open')) closeControls();
    else setFocus(false);
  });

  if (targetNote) new MutationObserver(syncStatus).observe(targetNote, { childList: true, characterData: true, subtree: true });
  if (detectedNote) new MutationObserver(syncStatus).observe(detectedNote, { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => {
    if (!practiceView.classList.contains('active')) setFocus(false);
  }).observe(practiceView, { attributes: true, attributeFilter: ['class'] });

  syncStatus();
}

queueMicrotask(initializeFocusMode);
