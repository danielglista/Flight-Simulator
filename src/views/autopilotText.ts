import { AP_NOTICE_S } from '../config/display';
import { STEP_HZ } from '../config/motion';
import type { ApNotice, ApReason, Autopilot } from '../sim/state';

/** Short on-screen words for each reason. */
const REASON: Readonly<Record<ApReason, string>> = {
  GROUND: 'GROUND',
  LOW: 'LOW',
  BANK: 'BANK',
  PITCH: 'PITCH',
  STALL: 'STALL',
  SLOW: 'SLOW',
  TERRAIN: 'TERRAIN',
  UNSETTLED: 'UNSETTLED',
  controls: 'KEYS',
};

export interface ApNoticeText {
  readonly text: string;
  readonly kind: 'refused' | 'dropped';
}

/** The notice to show now (it stays AP_NOTICE_S seconds of sim time), or null. `AP REFUSED: BANK` or `AP OFF: TERRAIN`. */
export function apNoticeText(notice: ApNotice | null, tick: number): ApNoticeText | null {
  if (!notice || tick - notice.tick < 0 || (tick - notice.tick) / STEP_HZ >= AP_NOTICE_S) return null;
  return { kind: notice.kind, text: notice.kind === 'refused' ? `AP REFUSED: ${REASON[notice.reason]}` : `AP OFF: ${REASON[notice.reason]}` };
}

/** The autopilot's part of the screen-reader sentence (empty when nothing is on and no notice shows). */
export function apSentence(ap: Autopilot, tick: number): string {
  const notice = apNoticeText(ap.notice, tick);
  const parts = [ap.hdg ? 'heading hold on' : '', ap.alt ? 'altitude hold on' : '', ap.spd ? 'speed hold on' : '', notice ? notice.text.toLowerCase().replace('ap off', 'autopilot off').replace('ap refused', 'autopilot refused') : ''].filter(Boolean);
  return parts.length ? `, ${parts.join(', ')}` : '';
}
