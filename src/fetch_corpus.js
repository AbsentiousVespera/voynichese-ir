// Downloads the ZL3b transliteration from voynich.nu into corpus/.
// The file is not committed to the repository — see README provenance notes.

const https = require('http');
const fs = require('fs');
const path = require('path');

const URL = 'http://www.voynich.nu/data/ZL3b-n.txt';
const DEST = path.join(__dirname, '..', 'corpus', 'ZL3b-n.txt');

fs.mkdirSync(path.dirname(DEST), { recursive: true });
console.log('fetching', URL);
https.get(URL, res => {
  if (res.statusCode !== 200) { console.error('HTTP', res.statusCode); process.exit(1); }
  const out = fs.createWriteStream(DEST);
  res.pipe(out);
  out.on('finish', () => {
    const kb = (fs.statSync(DEST).size / 1024).toFixed(0);
    console.log('saved', DEST, `(${kb} KB)`);
  });
}).on('error', e => { console.error(e.message); process.exit(1); });
