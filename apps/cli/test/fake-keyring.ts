import type { KeyringEntry, KeyringModule } from "../src/keys/keychain.js";

/** A fake of the `@napi-rs/keyring` surface Blame uses, backed by a Map. Never touches the OS. */
export interface FakeKeyring extends KeyringModule {
  readonly entries: Map<string, string>;
  readonly constructed: { service: string; account: string; options: unknown }[];
  /** When set, every native call rejects (or the constructor throws) with this error. */
  failWith: Error | undefined;
  failInConstructor: boolean;
  /** When set and it returns true, that one call rejects with `failWith` or a generic error. */
  failWhen: ((op: "get" | "set" | "delete", account: string) => boolean) | undefined;
  /** Runs before every get, so a test can change the store between two reads. */
  beforeGet: ((account: string) => void) | undefined;
}

export function fakeKeyring(): FakeKeyring {
  const entries = new Map<string, string>();
  const constructed: FakeKeyring["constructed"] = [];
  const state: FakeKeyring = {
    entries,
    constructed,
    failWith: undefined,
    failInConstructor: false,
    failWhen: undefined,
    beforeGet: undefined,
    AsyncEntry: class implements KeyringEntry {
      readonly #id: string;
      readonly #account: string;
      #check(op: "get" | "set" | "delete"): void {
        if (state.failWhen?.(op, this.#account)) {
          throw state.failWith ?? new Error("Platform failure: injected");
        }
        if (state.failWith && !state.failWhen) throw state.failWith;
      }
      constructor(service: string, account: string, options?: unknown) {
        constructed.push({ service, account, options });
        if (state.failInConstructor && state.failWith) throw state.failWith;
        this.#id = `${service}\u0000${account}`;
        this.#account = account;
      }
      async getPassword(): Promise<string | null> {
        state.beforeGet?.(this.#account);
        this.#check("get");
        return entries.get(this.#id) ?? null;
      }
      async setPassword(password: string): Promise<void> {
        this.#check("set");
        entries.set(this.#id, password);
      }
      async deletePassword(): Promise<boolean> {
        this.#check("delete");
        return entries.delete(this.#id);
      }
    },
  };
  return state;
}
