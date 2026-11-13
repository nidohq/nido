// Minimal WASI Preview 1 command host. No preopened directories, sockets, key,
// WebAuthn, DOM, storage, policy replacement, or signing imports exist.
export const LIMITS = Object.freeze({ input: 128 * 1024, output: 8192, memory: 64 * 1024 * 1024 });
export const ALLOWED_IMPORTS = Object.freeze(['args_get', 'args_sizes_get', 'environ_get', 'environ_sizes_get',
  'fd_close', 'fd_fdstat_get', 'fd_read', 'fd_seek', 'fd_write', 'proc_exit', 'random_get']);

export async function runWasi(binary, input) {
  const stdin = new TextEncoder().encode(input);
  if (stdin.length > LIMITS.input) throw Error('WASI input limit');
  const module = await WebAssembly.compile(binary);
  const imports = WebAssembly.Module.imports(module);
  for (const item of imports) {
    if (item.module !== 'wasi_snapshot_preview1' || item.kind !== 'function' || !ALLOWED_IMPORTS.includes(item.name))
      throw Error('Unapproved WASI import: ' + item.module + '.' + item.name);
  }
  let instance, offset = 0, total = 0; const output = [];
  const mem = () => new Uint8Array(instance.exports.memory.buffer);
  const view = () => new DataView(instance.exports.memory.buffer);
  const range = (ptr, n) => {
    ptr >>>= 0; n >>>= 0;
    if (ptr + n > mem().length || mem().length > LIMITS.memory) throw Error('WASI memory limit');
    return mem().subarray(ptr, ptr + n);
  };
  const u32 = (ptr, n) => { range(ptr, 4); view().setUint32(ptr, n, true); };
  const get32 = ptr => { range(ptr, 4); return view().getUint32(ptr, true); };
  class Exit { constructor(code) { this.code = code; } }
  const wasi = {
    args_sizes_get: (count, size) => { u32(count, 0); u32(size, 0); return 0; }, args_get: () => 0,
    environ_sizes_get: (count, size) => { u32(count, 0); u32(size, 0); return 0; }, environ_get: () => 0,
    fd_close: fd => fd <= 2 ? 0 : 8,
    fd_seek: () => 70, // ESPIPE: stdin/stdout are not seekable files.
    fd_fdstat_get: (fd, ptr) => {
      if (fd > 2) return 8;
      range(ptr, 24).fill(0); range(ptr, 1)[0] = 2; // character device
      view().setBigUint64(ptr + 8, fd === 0 ? 2n : 64n, true); return 0;
    },
    fd_read: (fd, iovs, count, read) => {
      if (fd !== 0) return 8;
      if (count > 1024) throw Error('WASI iovec limit');
      let n = 0;
      for (let i = 0; i < count; i++) {
        const ptr = get32(iovs + i * 8), length = get32(iovs + i * 8 + 4);
        const dest = range(ptr, length), take = Math.min(length, stdin.length - offset);
        dest.set(stdin.subarray(offset, offset + take)); offset += take; n += take;
      }
      u32(read, n); return 0;
    },
    fd_write: (fd, iovs, count, written) => {
      if (fd !== 1 && fd !== 2) return 8;
      if (count > 1024) throw Error('WASI iovec limit');
      let n = 0;
      for (let i = 0; i < count; i++) {
        const ptr = get32(iovs + i * 8), length = get32(iovs + i * 8 + 4);
        total += length; if (total > LIMITS.output) throw Error('WASI output limit');
        const data = range(ptr, length).slice(); if (fd === 1) output.push(data); n += length;
      }
      u32(written, n); return 0;
    },
    // Rust's randomized hash tables need entropy. This capability supplies public
    // random bytes only; it never exposes a key, seed or passkey PRF value.
    random_get: (ptr, length) => { if (length > 65536) throw Error('Randomness limit'); crypto.getRandomValues(range(ptr, length)); return 0; },
    proc_exit: code => { throw new Exit(code); },
  };
  instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi });
  try { instance.exports._start(); } catch (e) { if (!(e instanceof Exit) || e.code !== 0) throw e; }
  const combined = new Uint8Array(output.reduce((sum, v) => sum + v.length, 0)); let pos = 0;
  for (const part of output) { combined.set(part, pos); pos += part.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined));
}
