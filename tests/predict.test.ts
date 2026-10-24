import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixtures from './predictions.json' with { type: 'json' };
import { predict, validate } from '../lib/predict.js';

test('JS inference matches the original sklearn pipeline on 200 deterministic cases', () => {
  for (const fixture of fixtures) {
    const result = predict(validate(fixture.input));
    assert.equal(result.status, fixture.status);
    assert.ok(Math.abs(result.confidence - fixture.confidence) < 1e-12);
  }
});

test('rejects blank, nonfinite and out-of-range measurements', () => {
  const valid = { age_months: 20, weight_kg: 10, height_cm: 80, muac_cm: 14 };
  for (const key of Object.keys(valid)) {
    for (const value of ['', ' ', null, true, NaN, Infinity, -1, 1000, {}, []]) {
      assert.throws(() => validate({ ...valid, [key]: value }));
    }
  }
  assert.deepEqual(validate({ ...valid, age_months: '20' }), { ...valid, child: '' });
});

test('preserves BMI calculation and MUAC threshold behavior', () => {
  const input = { age_months: 30, weight_kg: 15, height_cm: 95, muac_cm: 11.49 };
  const result = predict(validate(input));
  assert.equal(result.status, 'severe');
  assert.equal(result.bmi, 15 / .95 ** 2);
  assert.ok(result.flags.some(flag => flag.includes('severe acute malnutrition')));
  assert.ok(!predict({ ...input, muac_cm: 11.5 }).flags.some(flag => flag.includes('severe acute malnutrition')));
  assert.ok(predict({ ...input, age_months: 5 }).flags.some(flag => flag.includes('Infant under 6 months')));
});
