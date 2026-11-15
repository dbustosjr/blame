import type { KeyringEntry, KeyringModule } from "../src/keys/keychain.js";

/** A fake of the `@napi-rs/keyring` surface Blame uses, backed by a Map. Never touches the OS. */
export interface FakeKeyring extends KeyringModule {
  readonly entries: Map<string, string>;
  readonly constructed: { service: string; account: string; options: unknown }[];
  /** When set, every native call rejects (or the constructor throws) with this error. */
  failWith: Error | undefined;
  failInConstructor: boolean;
}

export function fakeKeyring(): FakeKeyring {
  const entries = new Map<string, string>();
  const constructed: FakeKeyring["constructed"] = [];
  const state: FakeKeyring = {
    entries,
    constructed,
    failWith: undefined,
    failInConstructor: false,
    AsyncEntry: class implements KeyringEntry {
      readonly #id: string;
      constructor(service: string, account: string, options?: unknown) {
        constructed.push({ service, account, options });
        if (state.failInConstructor && state.failWith) throw state.failWith;
        this.#id = `${service}\u0000${account}`;
      }
      async getPassword(): Promise<string | null> {
        if (state.failWith) throw state.failWith;
        return entries.get(this.#id) ?? null;
      }
      async setPassword(password: string): Promise<void> {
        if (state.failWith) throw state.failWith;
        entries.set(this.#id, password);
      }
      async deletePassword(): Promise<boolean> {
        if (state.failWith) throw state.failWith;
        return entries.delete(this.#id);
      }
    },
  };
  return state;
}
