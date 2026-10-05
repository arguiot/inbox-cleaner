import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for (const folder of ['src','scripts','test']) for (const file of readdirSync(folder)) {
  if (!file.endsWith('.mjs')) continue;
  const result=spawnSync(process.execPath,['--check',`${folder}/${file}`],{stdio:'inherit'});
  if (result.status!==0) process.exit(result.status??1);
}
