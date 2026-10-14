/** Minimal protobuf wire-format reader — enough to walk an AAB's protobuf manifest. */

export function readVarint(buf, i) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = buf[i++];
    result += (b & 0x7f) * Math.pow(2, shift);
    shift += 7;
  } while (b & 0x80);
  return [result, i];
}

/** Decode a message into a flat list of { field, wire, value?, data? }. */
export function decodeFields(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const [tag, ni] = readVarint(buf, i);
    i = ni;
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      const [v, nj] = readVarint(buf, i);
      i = nj;
      out.push({ field, wire, value: v });
    } else if (wire === 2) {
      const [len, nk] = readVarint(buf, i);
      i = nk + len;
      out.push({ field, wire, data: buf.subarray(nk, i) });
    } else if (wire === 5) {
      out.push({ field, wire, value: buf.readUInt32LE(i) });
      i += 4;
    } else if (wire === 1) {
      out.push({ field, wire, value: Number(buf.readBigUInt64LE(i)) });
      i += 8;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
    if (i > buf.length) throw new Error('truncated protobuf message');
  }
  return out;
}

export const firstOf = (fields, n, wire) => fields.find((f) => f.field === n && (wire === undefined || f.wire === wire));
export const allOf = (fields, n, wire) => fields.filter((f) => f.field === n && (wire === undefined || f.wire === wire));
