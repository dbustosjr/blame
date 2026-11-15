import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KeychainKeyStore } from "../src/keys/keychain.js";

/**
 * Real OS keychain round trip. It writes to the keychain of the machine it runs on, so it is
 * opt-in: set BLAME_KEYCHAIN_TEST=1 on a machine with an unlocked keychain (a desktop session, or
 * Linux with a Secret Service such as gnome-keyring under dbus-run-session). When opted in, a
 * missing keychain fails the test instead of skipping, so it can never pass silently.
 */
const OPTED_IN = process.env.BLAME_KEYCHAIN_TEST === "1";
const SKIP_REASON =
  "skipped: real OS keychain test is opt-in (set BLAME_KEYCHAIN_TEST=1 with an unlocked keychain); CI runners have none";

describe.skipIf(!OPTED_IN)(
  OPTED_IN
    ? "KeychainKeyStore against the real OS keychain"
    : `KeychainKeyStore real keychain ${SKIP_REASON}`,
  () => {
    it("sets, gets, lists and deletes a fake key, then leaves nothing behind", async () => {
      const store = new KeychainKeyStore();
      const provider = `blame-test-${randomUUID().slice(0, 8)}`;
      const fakeKey = `fake-key-for-tests-${randomUUID()}`;
      try {
        await store.set(provider, fakeKey);
        expect(await store.get(provider)).toBe(fakeKey);
        expect(await store.list()).toContain(provider);
      } finally {
        await store.delete(provider);
      }
      expect(await store.get(provider)).toBeUndefined();
      expect(await store.list()).not.toContain(provider);
    });

    it("saves, refreshes and deletes a JWT-sized fake ChatGPT sign-in", async () => {
      const store = new KeychainKeyStore();
      // openai-codex is on the OAuth allowlist; save and restore anything already there.
      const provider = "openai-codex";
      const existing = await store.getOAuth(provider);
      const fake = (n: string) => ({
        access: `fake-access-${n}-${"a".repeat(3000)}`,
        refresh: `fake-refresh-${n}-${randomUUID()}`,
        expires: Date.now() + 3_600_000,
      });
      try {
        await store.setOAuth(provider, fake("1"));
        expect((await store.getOAuth(provider))?.access).toMatch(/^fake-access-1-/);
        const rotated = fake("2");
        await store.setOAuth(provider, rotated);
        expect(await store.getOAuth(provider)).toEqual(rotated);
      } finally {
        await store.deleteOAuth(provider);
        if (existing) await store.setOAuth(provider, existing);
      }
      if (!existing) expect(await store.getOAuth(provider)).toBeUndefined();
    });
  },
);

if (!OPTED_IN) {
  // Print the reason so a skipped run is visible in CI logs, not silent.
  console.info(`[keychain.real.test] ${SKIP_REASON}`);
}
