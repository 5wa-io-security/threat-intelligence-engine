import type { IncidentLLMEnrichment } from './classifier.js';
import type { AttackType, VictimType } from '../utils/constants.js';

export interface LLMQualityFixture {
  id: string;
  title: string;
  content: string;
  heuristicAttackType: AttackType;
  heuristicVictimType: VictimType;
  response: string;
  expected: IncidentLLMEnrichment;
}

/**
 * Small, redacted, deterministic examples for regression testing the
 * enrichment contract. These are not production article contents and do not
 * call an external provider.
 */
export const LLM_QUALITY_FIXTURES: LLMQualityFixture[] = [
  {
    id: 'armed-home-invasion',
    title: 'Crypto holder forced to transfer funds during home invasion',
    content: 'Armed intruders entered a crypto holder home and forced a transfer.',
    heuristicAttackType: 'other',
    heuristicVictimType: 'individual',
    response: JSON.stringify({
      severity: 8,
      attack_type: 'home_invasion',
      victim_type: 'individual',
      ai_summary: 'Armed intruders forced a crypto holder to transfer funds at home.',
      confidence_score: 0.96,
    }),
    expected: {
      severity: 8,
      attack_type: 'home_invasion',
      victim_type: 'individual',
      ai_summary: 'Armed intruders forced a crypto holder to transfer funds at home.',
      confidence_score: 0.96,
    },
  },
  {
    id: 'executive-kidnapping',
    title: 'Crypto executive kidnapped for ransom',
    content: 'A senior crypto executive was abducted and held while attackers demanded ransom.',
    heuristicAttackType: 'extortion',
    heuristicVictimType: 'individual',
    response: JSON.stringify({
      severity: 10,
      attack_type: 'kidnapping',
      victim_type: 'executive',
      ai_summary: 'A crypto executive was abducted and held for a ransom demand.',
      confidence_score: 0.91,
    }),
    expected: {
      severity: 10,
      attack_type: 'kidnapping',
      victim_type: 'executive',
      ai_summary: 'A crypto executive was abducted and held for a ransom demand.',
      confidence_score: 0.91,
    },
  },
];
