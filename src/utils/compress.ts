// LZW-based string compression and decompression for compact log storage
export function compressLZW(uncompressed: string): string {
  if (!uncompressed) return '';
  const dictionary: Record<string, number> = {};
  for (let i = 0; i < 256; i++) {
    dictionary[String.fromCharCode(i)] = i;
  }

  let word = "";
  const result: number[] = [];
  let dictSize = 256;

  for (let i = 0; i < uncompressed.length; i++) {
    const c = uncompressed[i];
    const wc = word + c;
    if (wc in dictionary) {
      word = wc;
    } else {
      result.push(dictionary[word]);
      if (dictSize < 16384) {
        dictionary[wc] = dictSize++;
      } else {
        // Reset dictionary to prevent too high character codes
        dictSize = 256;
      }
      word = String(c);
    }
  }

  if (word !== "") {
    result.push(dictionary[word]);
  }
  
  return JSON.stringify(result);
}

export function decompressLZW(compressed: string): string {
  if (!compressed) return '';
  let codes: number[];
  try {
    codes = JSON.parse(compressed);
  } catch {
    return compressed; // Fallback to raw string if it wasn't compressed
  }

  const dictionary: Record<number, string> = {};
  for (let i = 0; i < 256; i++) {
    dictionary[i] = String.fromCharCode(i);
  }

  if (codes.length === 0) return '';
  
  let oldWord = String.fromCharCode(codes[0]);
  const result = [oldWord];
  let dictSize = 256;

  for (let i = 1; i < codes.length; i++) {
    const code = codes[i];
    let s = "";
    if (code in dictionary) {
      s = dictionary[code];
    } else if (code === dictSize) {
      s = oldWord + oldWord[0];
    } else {
      return ""; // Fallback / corruption safety
    }
    result.push(s);
    if (dictSize < 16384) {
      dictionary[dictSize++] = oldWord + s[0];
    } else {
      dictSize = 256;
    }
    oldWord = s;
  }
  return result.join('');
}
