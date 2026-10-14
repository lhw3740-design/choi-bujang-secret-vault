// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required', 'resource_scope']);

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

function normalizePath(path) {
  return typeof path === 'string' ? path.replace(/\/+/gu, '/').replace(/\/$/u, '') || '/' : '';
}

function matchesExactPath(path, expected) {
  return normalizePath(path) === expected;
}

function matchesItemPath(path, prefix) {
  const normalized = normalizePath(path);
  const fullPrefix = normalizePath(prefix);
  if (!normalized.startsWith(fullPrefix)) return false;
  if (normalized === fullPrefix) return false;
  const remainder = normalized.slice(fullPrefix.length);
  return remainder.startsWith('/') && remainder.length > 1;
}

function checkResourceScope(request) {
  const method = typeof request?.method === 'string' ? request.method.toUpperCase() : '';
  const path = normalizePath(request?.path);
  const service = typeof request?.service === 'string' ? request.service.toLowerCase() : '';
  const route = typeof request?.route === 'string' ? request.route.toLowerCase() : '';

  if (!method || !path) {
    return false;
  }

  const notesLike = service === 'notes' || path.startsWith('/api/notes') || path.startsWith('/notes') || route.includes('/notes');
  const noticeLike = service === 'notices' || path.startsWith('/api/notices') || path.startsWith('/notices')
    || path.startsWith('/api/announcements') || path.startsWith('/announcements')
    || route.includes('/notices') || route.includes('/announcements');
  const teacherLike = service === 'teacher' || path.startsWith('/api/teacher') || path.startsWith('/teacher')
    || path.startsWith('/api/teacher-material') || path.startsWith('/teacher-material')
    || route.includes('/teacher');

  if (notesLike) {
    if (matchesExactPath(path, '/api/notes') || matchesExactPath(path, '/notes')) {
      return method === 'POST';
    }
    if (matchesItemPath(path, '/api/notes') || matchesItemPath(path, '/notes')) {
      return ['GET', 'PUT', 'DELETE'].includes(method);
    }
    return false;
  }

  if (noticeLike) {
    if (matchesExactPath(path, '/api/notices') || matchesExactPath(path, '/notices')
        || matchesExactPath(path, '/api/announcements') || matchesExactPath(path, '/announcements')) {
      return method === 'GET';
    }
    if (matchesItemPath(path, '/api/notices') || matchesItemPath(path, '/notices')
        || matchesItemPath(path, '/api/announcements') || matchesItemPath(path, '/announcements')) {
      return method === 'GET';
    }
    return false;
  }

  if (teacherLike) {
    return false;
  }

  return false;
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

  if (!checkResourceScope(request)) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'resource_scope_denied',
      ruleIds: ['device_registered', 'resource_scope'],
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
