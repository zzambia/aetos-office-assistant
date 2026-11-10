import { deflateRawSync } from 'node:zlib';
export function zipFixture(parts, compressed = false, stamp = 0) {
  const local=[], central=[]; let offset=0;
  for (const [name,value] of Object.entries(parts)) {
    const file=Buffer.from(name), content=Buffer.from(value), data=compressed?deflateRawSync(content):content;
    const l=Buffer.alloc(30); l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(compressed?8:0,8);l.writeUInt16LE(stamp,10);l.writeUInt32LE(data.length,18);l.writeUInt32LE(content.length,22);l.writeUInt16LE(file.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(compressed?8:0,10);c.writeUInt32LE(data.length,20);c.writeUInt32LE(content.length,24);c.writeUInt16LE(file.length,28);c.writeUInt32LE(offset,42);
    local.push(l,file,data);central.push(c,file);offset+=l.length+file.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(parts).length,8);end.writeUInt16LE(Object.keys(parts).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
