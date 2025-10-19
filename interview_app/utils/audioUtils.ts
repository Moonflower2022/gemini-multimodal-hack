
/**
 * Encodes raw byte data into a Base64 string.
 * This is a manual implementation to avoid external libraries.
 * @param bytes The Uint8Array to encode.
 * @returns The Base64 encoded string.
 */
export function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
