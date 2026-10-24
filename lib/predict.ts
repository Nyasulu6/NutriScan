import model from './model.json' with { type: 'json' };
import recommendations from './recommendations.json' with { type: 'json' };
export const limits = { age_months: [0, 60], weight_kg: [1, 30], height_cm: [40, 125], muac_cm: [5, 25] } as const;
export type Input = { child?: string; age_months: number; weight_kg: number; height_cm: number; muac_cm: number };
export type Status = 'normal' | 'moderate' | 'severe';
export function validate(input: unknown): Input {
  if (!input || typeof input !== 'object') throw new Error('An assessment is required.');
  const row = input as Record<string, unknown>;
  const out: Record<string, number | string> = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    const value = row[key];
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max)
      throw new Error(`${key} must be a number between ${min} and ${max}.`);
    out[key] = Number(value);
  }
  if (row.child !== undefined && typeof row.child !== 'string') throw new Error('Child name / ID must be text.');
  out.child = String(row.child ?? '').trim().slice(0, 150);
  return out as Input;
}
export function predict(input: Input) {
  const bmi = input.weight_kg / (input.height_cm / 100) ** 2;
  const features = [input.age_months, input.weight_kg, input.height_cm, input.muac_cm, bmi];
  const scaled = features.map((v, i) => (v - model.mean[i]) / model.scale[i]);
  const scores = model.coefficients.map((coef, i) => coef.reduce((sum, c, j) => sum + c * scaled[j], model.intercepts[i]));
  const maximum = Math.max(...scores);
  const exp = scores.map(v => Math.exp(v - maximum));
  const probabilities = exp.map(v => v / exp.reduce((a, b) => a + b, 0));
  const index = probabilities.indexOf(Math.max(...probabilities));
  let status = model.classes[index] as Status;
  const rule_override = input.muac_cm < 11.5 && status !== 'severe';
  if (input.muac_cm < 11.5) status = 'severe';
  const flags: string[] = [];
  if (input.muac_cm < 11.5) flags.push('MUAC < 11.5 cm: meets WHO criterion for severe acute malnutrition.');
  else if (input.muac_cm < 12.5) flags.push('MUAC 11.5–12.4 cm: moderate acute malnutrition range.');
  if (input.age_months < 6) flags.push('Infant under 6 months: prioritise breastfeeding support and refer for specialist care if at risk.');
  if (bmi < 12) flags.push('Very low BMI-for-age indicator: check weight and height measurements.');
  return { ...input, child: input.child || '', bmi, status, confidence: probabilities[index], rule_override, flags, title: recommendations[status][0], recommendations: recommendations[status][2] };
}
export function modelInfo() { return model.info; }
