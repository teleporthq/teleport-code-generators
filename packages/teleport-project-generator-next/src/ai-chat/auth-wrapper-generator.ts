import { UIDLAIAssistantChatAuthProtection } from '@teleporthq/teleport-types'

export function generateAuthWrapperCode(authProtection: UIDLAIAssistantChatAuthProtection): string {
  const allowedRoles = authProtection.allowedRoles || []
  const allowedRolesJson = JSON.stringify(allowedRoles)

  return `import React, { useState, useEffect } from 'react';
import AIChatWidget from './AIChatWidget';

var ALLOWED_ROLES = ${allowedRolesJson};

function useAIChatSession() {
  var [session, setSession] = useState(null);
  var [resolved, setResolved] = useState(false);

  function fetchSession() {
    return fetch('/api/auth/session')
      .then(function(res) { return res.ok ? res.json() : null; })
      .then(function(data) {
        if (data && data.user) return data;
        return null;
      })
      .catch(function() { return null; });
  }

  useEffect(function() {
    var cancelled = false;
    fetchSession().then(function(data) {
      if (!cancelled && data) setSession(data);
    }).finally(function() {
      if (!cancelled) setResolved(true);
    });
    return function() { cancelled = true; };
  }, []);

  useEffect(function() {
    function handler(e) {
      var user = e.detail && e.detail.user;
      setSession(user ? { user: user } : null);
      setResolved(true);
    }
    window.addEventListener('teleport:auth-user-changed', handler);
    return function() { window.removeEventListener('teleport:auth-user-changed', handler); };
  }, []);

  return { session: session, resolved: resolved };
}

export default function AIChatWrapper() {
  var auth = useAIChatSession();

  if (!auth.resolved) {
    return null;
  }

  if (!auth.session || !auth.session.user) {
    return null;
  }

  if (ALLOWED_ROLES.length > 0) {
    var userRole = auth.session.user.role;
    if (userRole == null || typeof userRole !== 'string') {
      userRole = auth.session.user.roleName || auth.session.user.roles?.[0];
    }
    var hasRole = userRole != null && ALLOWED_ROLES.indexOf(userRole) >= 0;
    if (!hasRole) {
      return null;
    }
  }

  return React.createElement(AIChatWidget);
}
`
}
