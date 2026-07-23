export class ScreenWakeLockManager {
  constructor({
    navigatorRef = globalThis.navigator,
    documentRef = globalThis.document,
    onStatus = () => {},
  } = {}) {
    this.navigator = navigatorRef
    this.document = documentRef
    this.onStatus = onStatus
    this.sentinel = null
    this.shouldHold = false
    this.requesting = null
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this)
    this.document?.addEventListener?.('visibilitychange', this.handleVisibilityChange)
  }

  get supported() {
    return Boolean(this.navigator?.wakeLock?.request)
  }

  async setEnabled(enabled) {
    this.shouldHold = Boolean(enabled)
    if (!this.shouldHold) {
      await this.release()
      this.onStatus('disabled')
      return false
    }
    return this.request()
  }

  async request() {
    if (!this.shouldHold) return false
    if (!this.supported) {
      this.onStatus('unsupported')
      return false
    }
    if (this.document?.visibilityState === 'hidden') return false
    if (this.sentinel && !this.sentinel.released) {
      this.onStatus('active')
      return true
    }
    if (this.requesting) return this.requesting

    this.requesting = (async () => {
      try {
        const sentinel = await this.navigator.wakeLock.request('screen')
        this.sentinel = sentinel
        sentinel.addEventListener?.('release', () => {
          if (this.sentinel === sentinel) this.sentinel = null
          if (this.shouldHold && this.document?.visibilityState !== 'hidden') {
            this.onStatus('released')
          }
        })
        this.onStatus('active')
        return true
      } catch (error) {
        this.onStatus('error', error)
        return false
      } finally {
        this.requesting = null
      }
    })()

    return this.requesting
  }

  async release() {
    const sentinel = this.sentinel
    this.sentinel = null
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release()
      } catch {
        // O navegador pode liberar o bloqueio antes da aplicação.
      }
    }
  }

  async handleVisibilityChange() {
    if (!this.shouldHold || this.document?.visibilityState !== 'visible') return
    await this.request()
  }

  async destroy() {
    this.shouldHold = false
    this.document?.removeEventListener?.('visibilitychange', this.handleVisibilityChange)
    await this.release()
  }
}
