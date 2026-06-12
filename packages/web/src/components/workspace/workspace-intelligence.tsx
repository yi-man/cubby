import { BookOpen, Boxes, Hammer, Loader2, RefreshCw, ScrollText, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  isWorkspaceIntelligenceResponse,
  type WorkspaceIntelligenceResponse,
} from './workspace-intelligence-model.js';

interface WorkspaceIntelligenceProps {
  rootPath: string;
  initialIntelligence?: WorkspaceIntelligenceResponse | null;
  onClose: () => void;
  onIntelligenceChange?: (intelligence: WorkspaceIntelligenceResponse) => void;
}

const ICON_PROPS = { size: 15, strokeWidth: 2.1, 'aria-hidden': true } as const;
const WORKSPACE_INTELLIGENCE_Z_INDEX = 1000;

export function WorkspaceIntelligence({
  rootPath,
  initialIntelligence = null,
  onClose,
  onIntelligenceChange,
}: WorkspaceIntelligenceProps) {
  const [intelligence, setIntelligence] = useState<WorkspaceIntelligenceResponse | null>(
    initialIntelligence,
  );
  const [loading, setLoading] = useState(!initialIntelligence);
  const [error, setError] = useState('');

  const loadIntelligence = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ root: rootPath });
      const response = await fetch(`/api/workspace/intelligence?${query.toString()}`);
      if (!response.ok) {
        setError('Workspace summary unavailable');
        return;
      }
      const data = await response.json();
      if (!isWorkspaceIntelligenceResponse(data)) {
        setError('Workspace summary unavailable');
        return;
      }
      setIntelligence(data);
      onIntelligenceChange?.(data);
    } catch {
      setError('Workspace summary unavailable');
    } finally {
      setLoading(false);
    }
  }, [onIntelligenceChange, rootPath]);

  useEffect(() => {
    if (!initialIntelligence) void loadIntelligence();
  }, [initialIntelligence, loadIntelligence]);

  return (
    <div
      data-testid="workspace-intelligence-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: WORKSPACE_INTELLIGENCE_Z_INDEX,
        background: 'rgba(0, 0, 0, 0.66)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-intelligence-title"
        style={{
          width: 'min(920px, 100%)',
          height: 'min(640px, calc(100dvh - 36px))',
          minHeight: 0,
          border: '1px solid #2a2d2a',
          borderRadius: '8px',
          background: '#0c0e0d',
          color: '#f4f3ea',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.56)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={headerStyle()}>
          <Boxes {...ICON_PROPS} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              id="workspace-intelligence-title"
              style={{ margin: 0, color: '#ffffff', fontSize: '14px', fontWeight: 700 }}
            >
              Workspace
            </h2>
            <div title={rootPath} style={pathStyle()}>
              {rootPath}
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh workspace intelligence"
            title="Refresh"
            onClick={() => void loadIntelligence()}
            disabled={loading}
            style={iconButtonStyle(!loading)}
          >
            {loading ? <Loader2 {...ICON_PROPS} /> : <RefreshCw {...ICON_PROPS} />}
          </button>
          <button
            type="button"
            aria-label="Close workspace intelligence"
            title="Close"
            onClick={onClose}
            style={iconButtonStyle(true)}
          >
            <X {...ICON_PROPS} />
          </button>
        </div>

        <div style={bodyStyle()}>
          {loading && !intelligence ? (
            <EmptyState label="Loading workspace summary" />
          ) : intelligence ? (
            <>
              <section style={sectionStyle()}>
                <SectionTitle icon={<Boxes {...ICON_PROPS} />} label="Project" />
                <MetaGrid
                  items={[
                    ['Package manager', intelligence.packageManager],
                    ['Evidence', intelligence.packageManagerEvidence ?? 'none'],
                  ]}
                />
                {intelligence.readme && (
                  <div style={{ display: 'grid', gap: '6px' }}>
                    <SectionTitle icon={<BookOpen {...ICON_PROPS} />} label="README" />
                    <div style={readmeBoxStyle()}>
                      <div style={{ color: '#ffffff', fontSize: '13px', fontWeight: 800 }}>
                        {intelligence.readme.title ?? intelligence.readme.path}
                      </div>
                      {intelligence.readme.excerpt && (
                        <p style={{ margin: '4px 0 0', color: '#b9bdb5', fontSize: '12px' }}>
                          {intelligence.readme.excerpt}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section style={sectionStyle()}>
                <SectionTitle icon={<Boxes {...ICON_PROPS} />} label="Frameworks" />
                {intelligence.frameworks.length === 0 ? (
                  <EmptyState compact label="No common frameworks detected" />
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {intelligence.frameworks.map((framework) => (
                      <span key={framework.name} title={framework.evidence} style={pillStyle()}>
                        {framework.name}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              <section style={sectionStyle()}>
                <SectionTitle icon={<ScrollText {...ICON_PROPS} />} label="Recommended Commands" />
                <CommandList
                  emptyLabel="No recommended commands"
                  items={intelligence.recommendedCommands}
                />
              </section>

              <section style={sectionStyle()}>
                <SectionTitle icon={<ScrollText {...ICON_PROPS} />} label="Package Scripts" />
                <CommandList emptyLabel="No package scripts" items={intelligence.scripts} />
              </section>

              <section style={sectionStyle()}>
                <SectionTitle icon={<Hammer {...ICON_PROPS} />} label="Make Targets" />
                <CommandList emptyLabel="No make targets" items={intelligence.makeTargets} />
              </section>

              <section style={sectionStyle()}>
                <SectionTitle icon={<BookOpen {...ICON_PROPS} />} label="Project Docs" />
                {intelligence.projectDocs.length === 0 ? (
                  <EmptyState compact label="No project docs found" />
                ) : (
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {intelligence.projectDocs.map((doc) => (
                      <article key={doc.path} style={docRowStyle()}>
                        <div style={{ color: '#f5f4ec', fontSize: '12px', fontWeight: 800 }}>
                          {doc.path}
                        </div>
                        <div style={{ color: '#8d928b', fontSize: '11px', fontWeight: 750 }}>
                          {doc.title ?? doc.kind}
                        </div>
                        {doc.excerpt && (
                          <div style={{ color: '#b9bdb5', fontSize: '12px' }}>{doc.excerpt}</div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section style={sectionStyle()}>
                <SectionTitle icon={<ScrollText {...ICON_PROPS} />} label="Context Prompt" />
                <pre style={contextPromptStyle()}>{intelligence.contextPrompt}</pre>
              </section>
            </>
          ) : (
            <EmptyState label="Workspace summary unavailable" />
          )}
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f5f4ec' }}>
      {icon}
      <div style={{ fontSize: '12px', fontWeight: 850 }}>{label}</div>
    </div>
  );
}

function MetaGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
      {items.map(([label, value]) => (
        <div key={label} style={metaCellStyle()}>
          <div style={{ color: '#777c76', fontSize: '10px', fontWeight: 800 }}>{label}</div>
          <div title={value} style={metaValueStyle()}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function CommandList({
  emptyLabel,
  items,
}: {
  emptyLabel: string;
  items: Array<{ name: string; command: string }>;
}) {
  if (items.length === 0) return <EmptyState label={emptyLabel} compact />;
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {items.map((item) => (
        <article key={`${item.name}:${item.command}`} style={commandRowStyle()}>
          <div style={{ color: '#f5f4ec', fontSize: '12px', fontWeight: 800 }}>{item.name}</div>
          <code title={item.command} style={commandCodeStyle()}>
            {item.command}
          </code>
        </article>
      ))}
    </div>
  );
}

function EmptyState({ compact = false, label }: { compact?: boolean; label: string }) {
  return (
    <div
      style={{
        minHeight: compact ? '42px' : 0,
        flex: compact ? undefined : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? '10px' : '24px',
        color: '#777c76',
        fontSize: '13px',
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  );
}

function InlineError({ children }: { children: string }) {
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid #3c2220',
        background: '#1b0d0c',
        color: '#f1b4aa',
        padding: '8px 10px',
        fontSize: '12px',
        fontWeight: 650,
      }}
    >
      {children}
    </div>
  );
}

function headerStyle() {
  return {
    minHeight: '46px',
    borderBottom: '1px solid #242624',
    padding: '0 12px 0 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'linear-gradient(180deg, #111412 0%, #0c0e0d 100%)',
  } as const;
}

function pathStyle() {
  return {
    marginTop: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#8d928b',
    fontFamily: 'monospace',
    fontSize: '11px',
  } as const;
}

function bodyStyle() {
  return {
    minHeight: 0,
    flex: 1,
    overflow: 'auto',
    background: '#050606',
    display: 'grid',
    alignContent: 'start',
    gap: '10px',
    padding: '12px',
  } as const;
}

function sectionStyle() {
  return {
    border: '1px solid #242624',
    borderRadius: '6px',
    background: '#090b0a',
    display: 'grid',
    gap: '10px',
    padding: '10px',
  } as const;
}

function readmeBoxStyle() {
  return {
    border: '1px solid #242a26',
    borderRadius: '6px',
    background: '#050606',
    padding: '9px',
  } as const;
}

function metaCellStyle() {
  return {
    minWidth: 0,
    border: '1px solid #242a26',
    borderRadius: '6px',
    background: '#050606',
    padding: '8px',
  } as const;
}

function metaValueStyle() {
  return {
    marginTop: '3px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#d7d5ca',
    fontFamily: 'monospace',
    fontSize: '12px',
  } as const;
}

function commandRowStyle() {
  return {
    minWidth: 0,
    border: '1px solid #242a26',
    borderRadius: '6px',
    background: '#050606',
    display: 'grid',
    gridTemplateColumns: 'minmax(90px, 0.32fr) minmax(0, 1fr)',
    gap: '8px',
    padding: '8px',
  } as const;
}

function commandCodeStyle() {
  return {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#d7d5ca',
    fontSize: '12px',
  } as const;
}

function docRowStyle() {
  return {
    border: '1px solid #242a26',
    borderRadius: '6px',
    background: '#050606',
    display: 'grid',
    gap: '4px',
    padding: '8px',
  } as const;
}

function contextPromptStyle() {
  return {
    margin: 0,
    maxHeight: '170px',
    overflow: 'auto',
    border: '1px solid #242a26',
    borderRadius: '6px',
    background: '#050606',
    color: '#d7d5ca',
    padding: '9px',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontSize: '12px',
    lineHeight: '18px',
  } as const;
}

function pillStyle() {
  return {
    border: '1px solid #253b40',
    borderRadius: '999px',
    background: '#071a1f',
    color: '#9ce8f8',
    padding: '3px 8px',
    fontSize: '11px',
    fontWeight: 800,
  } as const;
}

function iconButtonStyle(enabled: boolean) {
  return {
    width: '30px',
    height: '30px',
    border: `1px solid ${enabled ? '#303331' : '#202220'}`,
    borderRadius: '6px',
    background: enabled ? '#141715' : '#0d0f0e',
    color: enabled ? '#d7d5ca' : '#5f645e',
    cursor: enabled ? 'pointer' : 'default',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    flexShrink: 0,
  } as const;
}
