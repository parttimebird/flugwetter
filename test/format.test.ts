// Formatierung: Höhen auf 100 m, Grundwind- und Böenstufen, Böigkeit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboveStart, alt100, baseWindClass, gustClass, plus100 } from '../src/format.ts';

test('Höhen aus dem Modell werden auf 100 m gerundet', () => {
  assert.equal(alt100(1284), 'rund 1.300 m');
  assert.equal(alt100(1760), 'rund 1.800 m');
  assert.equal(aboveStart(13), 'kaum über dem Start');
  assert.equal(aboveStart(60), 'rund 100 m über dem Start');
  assert.equal(plus100(812), '+800 m');
});

test('Grundwind und Böen nach den Stufen aus dem Konzept', () => {
  assert.equal(baseWindClass(8), 'schwach');
  assert.equal(baseWindClass(12), 'mäßig');
  assert.equal(baseWindClass(22), 'stark');
  assert.equal(gustClass(20), 'mäßig');
  assert.equal(gustClass(33), 'stark');
  assert.equal(gustClass(36), 'sehr stark, kritisch');
});
