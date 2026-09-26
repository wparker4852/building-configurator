// Decode a shared design link back into a readable config.
//
//   npm run decode -- "http://localhost:5180/#d=eyJtb2RlbElkIjoi..."
//   npm run decode -- eyJtb2RlbElkIjoi...
//
// Every design is encoded entirely in the URL hash, so pasting a link is the
// most precise possible bug report: it reproduces the exact building.

const input = process.argv[2];

if (!input) {
  console.error('Usage: npm run decode -- "<share link or #d= token>"');
  process.exit(1);
}

const token = input.includes('#d=') ? input.split('#d=')[1] : input.replace(/^#?d=/, '');

function fromBase64Url(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

let cfg;
try {
  cfg = JSON.parse(fromBase64Url(token.trim()));
} catch (err) {
  console.error('Could not decode that token:', err.message);
  process.exit(1);
}

// Openings travel as [catalogId, wall, offset, sill] tuples.
const openings = (cfg.openings ?? []).map((o) =>
  Array.isArray(o) ? { catalogId: o[0], wall: o[1], offset: o[2], sill: o[3] } : o,
);

console.log(JSON.stringify({ ...cfg, openings }, null, 2));
console.log(
  `\n${cfg.modelId} · ${cfg.width}'W x ${cfg.length}'L x ${cfg.eaveHeight}'H · ` +
    `${cfg.roofBuild} ${cfg.roofStyle} ${cfg.pitch}/12 · ${cfg.onCenter}' OC · ` +
    `${cfg.enclosure} · ${openings.length} opening(s)`,
);
