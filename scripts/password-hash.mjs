import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
let password='';
if(process.stdin.isTTY){
 process.stderr.write('Owner password (16+ characters, hidden): ');process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
 password=await new Promise((resolve,reject)=>{const input=chunk=>{for(const ch of chunk){if(ch==='\u0003'){process.stdin.setRawMode(false);process.stdin.pause();reject(new Error('Cancelled'));return;}if(ch==='\r'||ch==='\n'){process.stdin.off('data',input);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');resolve(password);return;}if(ch==='\u007f'||ch==='\b')password=password.slice(0,-1);else password+=ch;}};process.stdin.on('data',input);});
}else{const rl=createInterface({input:process.stdin});password=await rl.question('');rl.close();}
if(password.length<16)throw new Error('Use at least 16 characters.');const salt=randomBytes(24).toString('hex'),iterations=600000;
process.stdout.write(`pbkdf2$${iterations}$${salt}$${pbkdf2Sync(password,salt,iterations,32,'sha256').toString('hex')}\n`);
