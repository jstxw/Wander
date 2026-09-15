import test from 'node:test';
import assert from 'node:assert/strict';
test('landing settings persist only model and voice and reject foreign senders or invalid choices', async () => {
 const original = globalThis.chrome;
 const values = {token:'private',modelMode:'low',voiceURI:'browser-default'};
 let external, internal;
 const listener = {addListener() {}};
 globalThis.chrome = {
  storage:{local:{get:async keys => Object.fromEntries(keys.map(k => [k,values[k]])),set:async data => Object.assign(values,data)}},
  runtime:{onMessageExternal:{addListener(fn){external=fn;}},onMessage:{addListener(fn){internal=fn;}}},
  action:{onClicked:listener},tabs:{onUpdated:listener,onRemoved:listener}
 };
 try {
  await import('../extension/background.js');
  const silent = await new Promise(resolve => internal({type:'WANDER_SPEAK',text:'Must stay silent'},{tab:{id:12,url:'http://127.0.0.1:4318/'},url:'http://127.0.0.1:4318/'},resolve));
  assert.equal(silent.ok,false);
  assert.match(silent.error,/does not speak/);
  const call = message => new Promise(resolve => external(message,{url:'http://127.0.0.1:4318/'},resolve));
  assert.deepEqual(await call({type:'WANDER_GET_PREFERENCES'}),{modelMode:'low',voiceURI:'browser-default'});
  assert.deepEqual(await call({type:'WANDER_SET_PREFERENCES',modelMode:'high',voiceURI:'elevenlabs',token:'overwrite'}),{ok:true});
  assert.equal(values.token,'private');
  assert.deepEqual(await call({type:'WANDER_GET_PREFERENCES'}),{modelMode:'high',voiceURI:'elevenlabs'});
  assert.ok((await call({type:'WANDER_SET_PREFERENCES',modelMode:'invalid',voiceURI:'x'})).error);
  let replied=false;
  external({type:'WANDER_SET_PREFERENCES',modelMode:'low',voiceURI:'x'},{url:'https://example.com/'},()=>replied=true);
  assert.equal(replied,false); assert.equal(values.modelMode,'high');
 } finally {globalThis.chrome=original;}
});
