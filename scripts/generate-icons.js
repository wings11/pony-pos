const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

async function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function main() {
  const projectRoot = process.cwd();
  const sourceLogo = path.join(projectRoot, 'logo.jpg');
  const buildDir = path.join(projectRoot, 'build');

  if (!fs.existsSync(sourceLogo)) {
    throw new Error('logo.jpg not found in project root.');
  }

  await ensureDir(buildDir);

  const masterPng = path.join(buildDir, 'icon-1024.png');
  await sharp(sourceLogo)
    .resize(1024, 1024, {
      fit: 'contain',
      background: '#ffffff'
    })
    .png()
    .toFile(masterPng);

  const sizes = [256, 128, 64, 48, 32, 24, 16];
  const pngFiles = [];

  for (const size of sizes) {
    const outFile = path.join(buildDir, `icon-${size}.png`);
    await sharp(masterPng)
      .resize(size, size)
      .png()
      .toFile(outFile);
    pngFiles.push(outFile);
  }

  const icoBuffer = await pngToIco(pngFiles);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);

  console.log('Icons generated in build/: icon.ico and icon-*.png');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
