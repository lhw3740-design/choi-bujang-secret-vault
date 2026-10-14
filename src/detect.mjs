// 9단계에서 학생이 채우는 탐지 함수입니다. 반 엔진이 검증한 사건만 전달해야 하며,
// 브라우저가 보낸 사용자 번호는 신원으로 취급하지 않습니다.
export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');

  const bySubject = new Map();
  for (const event of events) {
    if (!event || typeof event.at !== 'string' || event.method !== 'GET') continue;
    const subject = event?.identity?.sub;
    if (typeof subject !== 'string' || subject.length === 0) continue;
    const current = bySubject.get(subject) ?? [];
    current.push(new Date(event.at).getTime());
    bySubject.set(subject, current);
  }

  for (const [subject, timestamps] of bySubject.entries()) {
    const ordered = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
    let left = 0;
    for (let right = 0; right < ordered.length; right += 1) {
      while (ordered[right] - ordered[left] > 10 * 60 * 1000) {
        left += 1;
      }
      if (right - left + 1 > 120) {
        return {
          action: 'propose_revocation',
          reasonCode: 'burst_read',
          subject,
        };
      }
    }
  }

  return { action: 'observe' };
}
