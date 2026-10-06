import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'data.json');
const output = resolve(root, 'public', 'data.json');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (config.step !== 1) {
  throw new Error('1단계 이후에는 공개 data.json 복사를 끝내고 보호된 자료 API로 바꾸세요.');
}
const data = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(data.notes) || data.notes.length > 0) {
  throw new Error('공개 자료에는 메모를 포함할 수 없습니다. 자료는 보호된 저장소에 보관하세요.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
await copyFile(source, output);
console.log('실습용 공개 자료를 public/data.json에 복사했습니다.');
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'),
    `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 저장소·커밋·주소를 public/aleph.json에 기록했습니다.');
}
