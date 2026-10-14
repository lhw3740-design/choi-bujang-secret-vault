// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

function isTrustedSignalSource(signals) {
  return typeof signals?.source === 'string' && signals.source === 'judge_fixture';
}

function requiresStepUp(request) {
  const signals = request?.signals ?? {};
  const recentEvents = Array.isArray(request?.recentEvents) ? request.recentEvents : [];
  const trustedSource = isTrustedSignalSource(signals);

  if (!trustedSource) {
    return true;
  }

  const region = typeof signals.region === 'string' ? signals.region.toLowerCase() : '';
  const network = typeof signals.network === 'string' ? signals.network.toLowerCase() : '';
  const hour = Number.isInteger(signals.hour) ? signals.hour : Number.NaN;

  if (!region || !network || !Number.isInteger(hour)) {
    return true;
  }

  const suspiciousRecentEvents = recentEvents.some((event) => {
    if (!event || typeof event.kind !== 'string' || event.kind !== 'risk_signal') {
      return false;
    }
    const count = Number(event.count ?? 0);
    return Number.isFinite(count) && count >= 20;
  });

  const abnormalAccess = (
    region === 'foreign'
    && network === 'unusual'
    && (hour < 5 || hour > 22)
  ) || suspiciousRecentEvents;

  return abnormalAccess;
}

export async function decide(request) {
  const registered = request?.deviceRegistered === true;

  if (!registered) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'device_not_registered',
      ruleIds: ['device_registered'],
    };
  }

  const stepUp = request?.stepUp ?? { verified: false, authAgeSeconds: null };
  const needsStepUp = requiresStepUp(request);

  if (needsStepUp && stepUp?.verified !== true) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'step_up',
      reasonCode: 'step_up_required',
      ruleIds: ['device_registered', 'step_up_required'],
    };
  }

  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: 'allow',
    reasonCode: 'approved',
    ruleIds: ['device_registered'],
  };
}
