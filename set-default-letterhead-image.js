const fs = require('fs');
const path = require('path');

const root = process.cwd();

const sourceImagePath = path.join(root, 'default-header.png');
const targetDir = path.join(root, 'assets', 'images');
const targetImagePath = path.join(targetDir, 'altaraf.png');

const backupDir = path.join(root, '.default-letterhead-image-backup');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  ensureDir(backupDir);

  const backupName = `${path.basename(filePath)}.${Date.now()}.bak`;
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  return backupPath;
}

function main() {
  if (!fs.existsSync(sourceImagePath)) {
    throw new Error(
      `Source image not found: ${sourceImagePath}\n` +
      `ضع الصورة في جذر المشروع باسم default-header.png ثم أعد التشغيل.`
    );
  }

  ensureDir(targetDir);

  backupFile(targetImagePath);

  fs.copyFileSync(sourceImagePath, targetImagePath);

  console.log('');
  console.log('Done.');
  console.log(`Default letterhead image has been set successfully.`);
  console.log(`Target: ${targetImagePath}`);
  console.log('');
  console.log('Now run:');
  console.log('npm run typecheck');
  console.log('npx expo start -c --port 8082');
}

try {
  main();
} catch (error) {
  console.error('');
  console.error('Failed:');
  console.error(error.message || error);
  process.exit(1);
}