import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {Gmail} from '../src/gmail.mjs';
const [clientFile,email]=process.argv.slice(2);
if (!clientFile || !/^\S+@\S+\.\S+$/.test(email??''))
  throw new Error('Usage: npm run auth:gmail -- private/google-client.json <account-email>');
const raw=JSON.parse(await readFile(clientFile,'utf8')), client=raw.installed??raw.web;
if (!client?.client_id || !client.client_secret) throw new Error('Google OAuth client file required');
const state=randomBytes(24).toString('base64url'), verifier=randomBytes(32).toString('base64url');
const challenge=createHash('sha256').update(verifier).digest('base64url');
const redirect='http://127.0.0.1:8765/callback';
const authorization=new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorization.search=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',
  scope:'https://www.googleapis.com/auth/gmail.modify',access_type:'offline',prompt:'consent',login_hint:email,state,
  code_challenge:challenge,code_challenge_method:'S256'}).toString();
const timer=setTimeout(()=>{console.error('Authorization timed out');process.exit(1);},600000);
const server=createServer(async(request,response)=>{
  try {
    const url=new URL(request.url,redirect);
    if (url.pathname!=='/callback' || url.searchParams.get('state')!==state) {response.writeHead(400);response.end('Invalid authorization request');return;}
    if (!url.searchParams.get('code')) throw new Error('Authorization denied');
    const exchange=await fetch('https://oauth2.googleapis.com/token',{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({
        client_id:client.client_id,client_secret:client.client_secret,code:url.searchParams.get('code'),
        grant_type:'authorization_code',redirect_uri:redirect,code_verifier:verifier}),signal:AbortSignal.timeout(15000)});
    if (!exchange.ok) throw new Error('Token exchange failed');
    const tokens=await exchange.json();
    if (!tokens.refresh_token) throw new Error('Offline authorization missing');
    const profile=await new Gmail(tokens.access_token).profile();
    if (profile.emailAddress.toLowerCase()!==email.toLowerCase()) throw new Error('Wrong Google account');
    await mkdir('private',{recursive:true});
    let accounts=[];
    try {accounts=JSON.parse(await readFile('private/accounts.json','utf8'));} catch(error) {if (error.code!=='ENOENT') throw error;}
    accounts=accounts.filter(x=>x.email!==email);
    accounts.push({email,refreshToken:tokens.refresh_token});
    await writeFile('private/accounts.json',JSON.stringify(accounts),{mode:0o600});
    response.end('Connected. You can close this tab. No messages were changed.');
    console.log(`Connected ${email}; credentials saved in ignored private/accounts.json`);
    clearTimeout(timer);server.close();
  } catch {
    response.writeHead(400);response.end('Authorization failed. Check the selected account and try again.');
    console.error('Google authorization failed; credentials were not printed');
    clearTimeout(timer);server.close();process.exitCode=1;
  }
});
server.listen(8765,'127.0.0.1',()=>console.log(authorization.href));
