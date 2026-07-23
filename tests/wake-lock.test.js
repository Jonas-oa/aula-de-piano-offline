import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenWakeLockManager } from '../src/core/screen-wake-lock.js';

function fakeDocument() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    async dispatch(type) {
      await listeners.get(type)?.();
    },
  };
}

function fakeSentinel() {
  const listeners = new Map();
  return {
    released: false,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    async release() {
      this.released = true;
      listeners.get('release')?.();
    },
    systemRelease() {
      this.released = true;
      listeners.get('release')?.();
    },
  };
}

test('wake lock mantém a tela ativa e pode ser desligado', async () => {
  const documentRef = fakeDocument();
  const sentinels = [];
  const statuses = [];
  const manager = new ScreenWakeLockManager({
    documentRef,
    navigatorRef: {
      wakeLock: {
        async request(type) {
          assert.equal(type, 'screen');
          const sentinel = fakeSentinel();
          sentinels.push(sentinel);
          return sentinel;
        },
      },
    },
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(await manager.setEnabled(true), true);
  assert.equal(sentinels.length, 1);
  assert.equal(statuses.at(-1), 'active');

  await manager.setEnabled(false);
  assert.equal(sentinels[0].released, true);
  assert.equal(statuses.at(-1), 'disabled');
});

test('wake lock é solicitado novamente quando a prática volta ao primeiro plano', async () => {
  const documentRef = fakeDocument();
  const sentinels = [];
  const manager = new ScreenWakeLockManager({
    documentRef,
    navigatorRef: {
      wakeLock: {
        async request() {
          const sentinel = fakeSentinel();
          sentinels.push(sentinel);
          return sentinel;
        },
      },
    },
  });

  await manager.setEnabled(true);
  documentRef.visibilityState = 'hidden';
  sentinels[0].systemRelease();
  documentRef.visibilityState = 'visible';
  await documentRef.dispatch('visibilitychange');

  assert.equal(sentinels.length, 2);
  assert.equal(manager.sentinel, sentinels[1]);
});
