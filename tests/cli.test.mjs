import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const exec = promisify(execFile);
const cli=resolve('dist/cli.js');
test('CLI help and demo work without credentials, and demo restores its project',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pk-cli-'));
 try {
  const help=await exec(process.execPath,[cli,'--help']);assert.match(help.stdout,/evidence-backed/);
  const {stdout,stderr}=await exec(process.execPath,[cli,'demo'],{env:{...process.env,PK_LIBRARY_DIR:dir,PK_PROVIDER:''}});
  assert.equal(stderr,'');const data=JSON.parse(stdout);assert.equal(data.roundTrip.status,'complete');
  assert.match(await readFile(data.exports.markdown.path,'utf8'),/Synthetic|synthetic/);
  assert.match(await readFile(data.exports.html.path,'utf8'),/<!doctype html>/i);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('actual stdio subprocess keeps stdout valid MCP and can discover tools',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pk-stdio-'));
 const client=new Client({name:'stdio-protocol-smoke',version:'0.1.0'});
 try {
  await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'serve'],env:{...process.env,PK_STORAGE:'memory',PK_LIBRARY_DIR:dir,PK_PROVIDER:''}}));
  assert.ok((await client.listTools()).tools.some(t=>t.name==='source_import'));
  const result=await client.callTool({name:'project_create',arguments:{address:'Synthetic address',question:'Who occupied it?'}});
  assert.equal(result.isError,undefined);assert.ok(result.structuredContent.result.projectId);
 } finally {await client.close();await rm(dir,{recursive:true,force:true});}
});
