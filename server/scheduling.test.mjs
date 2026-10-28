import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { cafeThursday, makeSlots, overlaps, classifySlots } from './scheduling.mjs';
import { initDb, countAt, reserveAtomically } from './db.mjs';

test('Tuesday October 27, 2026 selects Thursday October 29',()=>{
  assert.equal(cafeThursday(DateTime.fromISO('2026-10-27T16:22:00',{zone:'America/Los_Angeles'})), '2026-10-29');
});
test('on Thursday after 8PM choose following week',()=>{
  assert.equal(cafeThursday(DateTime.fromISO('2026-10-29T20:15:00',{zone:'America/Los_Angeles'})), '2026-11-05');
});
test('generates twenty 30-minute slots from 10AM to 8PM',()=>{
  const slots=makeSlots('2026-10-29');
  assert.equal(slots.length,20);
  assert.equal(DateTime.fromISO(slots[0].start).setZone('America/Los_Angeles').toFormat('HH:mm'),'10:00');
  assert.equal(DateTime.fromISO(slots.at(-1).end).setZone('America/Los_Angeles').toFormat('HH:mm'),'20:00');
});
test('adjacent reservations do not overlap',()=>{
  const s=makeSlots('2026-10-29');
  assert.equal(overlaps(s[0].start,s[0].end,s[1].start,s[1].end),false);
});
test('full slots are unavailable, but adjacent slots remain available',()=>{
  const slots=makeSlots('2026-10-29');
  const out=classifySlots(slots,[],(start)=>start===slots[0].start?10:9,10);
  assert.equal(out[0].available,false);
  assert.equal(out[1].available,true);
});
test('10 concurrent spots maximum and blocks an 11th reservation',()=>{
  const db=initDb(':memory:');
  const [slot]=makeSlots('2026-10-29');
  for(let i=0;i<10;i++){
    assert.deepEqual(reserveAtomically(db,{id:`test${i}`,userKey:`u${i}`,name:`u${i}`,email:null,mode:'demo',start:slot.start,end:slot.end,capacity:10}),{id:`test${i}`});
  }
  assert.equal(countAt(db,slot.start,slot.end),10);
  assert.equal(reserveAtomically(db,{id:'eleven',userKey:'u11',name:'u11',email:null,mode:'demo',start:slot.start,end:slot.end,capacity:10}).error,'FULL');
  assert.equal(countAt(db,slot.start,slot.end),10);
  db.close();
});
test('same person cannot book overlapping intervals',()=>{
  const db=initDb(':memory:');
  const [slot]=makeSlots('2026-10-29');
  const params={userKey:'same',name:'name',email:null,mode:'demo',start:slot.start,end:slot.end,capacity:10};
  reserveAtomically(db,{...params,id:'1'});
  assert.equal(reserveAtomically(db,{...params,id:'2'}).error,'DUPLICATE');
  db.close();
});
