import type { Session } from '@cubby/core';
import type { CSSProperties } from 'react';

import claudeIconUrl from '../../assets/provider-icons/claude.svg?url';
import openAiIconUrl from '../../assets/provider-icons/openai.svg?url';
import openCodeIconUrl from '../../assets/provider-icons/opencode.svg?url';

const PROVIDER_ICON_SIZE = 18;

interface ProviderIconDefinition {
  label: string;
  iconTitle: string;
  src: string;
  style: CSSProperties;
}

const PROVIDER_ICONS: Record<string, ProviderIconDefinition> = {
  'claude-code': {
    label: 'Claude Code',
    iconTitle: 'Claude',
    src: claudeIconUrl,
    style: {
      border: '1px solid #4a372f',
      background: '#211814',
      color: '#d97757',
    },
  },
  codex: {
    label: 'Codex',
    iconTitle: 'OpenAI',
    src: openAiIconUrl,
    style: {
      border: '1px solid #4f504a',
      background: '#f1f0eb',
      color: '#111615',
    },
  },
  opencode: {
    label: 'OpenCode',
    iconTitle: 'OpenCode',
    src: openCodeIconUrl,
    style: {
      border: '1px solid #4a4a46',
      background: '#e7e5e1',
      color: '#211e1e',
    },
  },
};

export function providerLabel(provider: Session['provider']): string {
  return PROVIDER_ICONS[provider]?.label ?? provider;
}

function providerInitial(provider: string): string {
  const trimmed = provider.trim();
  if (!trimmed) return '?';
  return trimmed[0]?.toUpperCase() ?? '?';
}

export function ProviderIcon({ provider }: { provider: Session['provider'] }) {
  const label = `${providerLabel(provider)} provider`;
  const commonStyle = {
    flexShrink: 0,
    width: `${PROVIDER_ICON_SIZE}px`,
    height: `${PROVIDER_ICON_SIZE}px`,
    borderRadius: '5px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2px',
  } as const;
  const icon = PROVIDER_ICONS[provider];

  if (icon) {
    return (
      <span
        aria-label={label}
        className="provider-brand-icon"
        role="img"
        title={label}
        style={{
          ...commonStyle,
          ...icon.style,
        }}
      >
        <img
          alt=""
          aria-hidden="true"
          data-icon-title={icon.iconTitle}
          draggable={false}
          src={icon.src}
        />
      </span>
    );
  }

  return (
    <span
      aria-label={label}
      role="img"
      title={label}
      style={{
        ...commonStyle,
        border: '1px solid #44443e',
        background: '#1c1c19',
        color: '#d8d6ca',
        fontSize: '11px',
        fontWeight: 850,
        lineHeight: 1,
      }}
    >
      {providerInitial(provider)}
    </span>
  );
}
